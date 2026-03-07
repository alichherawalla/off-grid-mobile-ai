import Foundation
import UIKit
import CoreML
import React
import StableDiffusion

/// React Native bridge for Apple's ml-stable-diffusion pipeline.
/// Mirrors the Android LocalDreamModule interface so the TypeScript layer
/// can use a single abstraction via Platform.select().
@objc(CoreMLDiffusionModule)
class CoreMLDiffusionModule: RCTEventEmitter {

  // MARK: - State

  /// Both StableDiffusionPipeline and StableDiffusionXLPipeline conform to
  /// StableDiffusionPipelineProtocol, so we store whichever one was created.
  private var pipeline: StableDiffusionPipelineProtocol?
  private var loadedModelPath: String?
  private var generating = false
  private var cancelRequested = false

  // Serial queue for all pipeline operations
  private let pipelineQueue = DispatchQueue(label: "ai.offgridmobile.coreml.diffusion", qos: .userInitiated)

  override init() {
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleMemoryWarning),
      name: UIApplication.didReceiveMemoryWarningNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func handleMemoryWarning() {
    // If we're not actively generating, release the pipeline to free memory
    guard !generating else { return }
    if pipeline != nil {
      NSLog("[CoreMLDiffusion] Memory warning received — unloading pipeline to prevent crash")
      pipeline = nil
      loadedModelPath = nil
      sendEvent(withName: "LocalDreamError", body: [
        "error": "Model unloaded due to low memory. Please try a smaller model."
      ])
    }
  }

  // MARK: - RCTEventEmitter

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["LocalDreamProgress", "LocalDreamError"]
  }

  // MARK: - SDXL detection

  /// Returns true if the model directory contains TextEncoder2.mlmodelc,
  /// which is the hallmark of an SDXL model.
  private func isXLModel(at url: URL) -> Bool {
    let te2 = url.appendingPathComponent("TextEncoder2.mlmodelc")
    return FileManager.default.fileExists(atPath: te2.path)
  }

  // MARK: - loadModel

  @objc func loadModel(_ params: NSDictionary,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let modelPath = params["modelPath"] as? String else {
      reject("ERR_INVALID_PARAMS", "modelPath is required", nil)
      return
    }

    pipelineQueue.async { [weak self] in
      guard let self = self else { return }

      // Unload previous if different path
      if self.loadedModelPath != nil && self.loadedModelPath != modelPath {
        self.pipeline = nil
        self.loadedModelPath = nil
      }

      do {
        let url = URL(fileURLWithPath: modelPath)

        let cpuOnly = params["cpuOnly"] as? Bool ?? false
        let config = MLModelConfiguration()
        let attentionVariant = params["attentionVariant"] as? String ?? "split_einsum"
        // ANE is required — palettized weights produce gray images on pure CPU.
        // cpuAndGPU fallback lets low-memory devices avoid ANE compilation overhead.
        config.computeUnits = cpuOnly ? .cpuAndGPU : .cpuAndNeuralEngine

        let pipe: StableDiffusionPipelineProtocol

        if self.isXLModel(at: url) {
          // SDXL models need the XL pipeline which uses TextEncoderXL
          // (expects "hidden_embeds" output instead of "last_hidden_state")
          pipe = try StableDiffusionXLPipeline(
            resourcesAt: url,
            configuration: config,
            reduceMemory: true
          )
        } else {
          pipe = try StableDiffusionPipeline(
            resourcesAt: url,
            controlNet: [],
            configuration: config,
            reduceMemory: true
          )
        }

        // Skip prewarm for 'original' variant (low-memory devices): prewarm
        // loads the full Unet into memory just to unload it, causing an OOM spike.
        // With reduceMemory=true the pipeline lazily loads each submodel during
        // generateImages(), so prewarming is unnecessary.
        if attentionVariant != "original" {
          try pipe.loadResources()
        }

        self.pipeline = pipe
        self.loadedModelPath = modelPath
        resolve(true)
      } catch {
        reject("ERR_LOAD_FAILED", "Failed to load Core ML model: \(error.localizedDescription)", error)
      }
    }
  }

  // MARK: - unloadModel

  @objc func unloadModel(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    pipelineQueue.async { [weak self] in
      self?.pipeline = nil
      self?.loadedModelPath = nil
      resolve(true)
    }
  }

  // MARK: - isModelLoaded

  @objc func isModelLoaded(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(pipeline != nil)
  }

  // MARK: - getLoadedModelPath

  @objc func getLoadedModelPath(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(loadedModelPath as Any)
  }

  // MARK: - generateImage

  @objc func generateImage(_ params: NSDictionary,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let pipe = pipeline else {
      reject("ERR_NO_MODEL", "No model loaded", nil)
      return
    }

    guard !generating else {
      reject("ERR_BUSY", "Image generation already in progress", nil)
      return
    }

    let prompt = params["prompt"] as? String ?? ""
    let negativePrompt = params["negativePrompt"] as? String ?? ""
    let steps = params["steps"] as? Int ?? 20
    let guidanceScale = params["guidanceScale"] as? Double ?? 7.5
    let seed = params["seed"] as? UInt32 ?? UInt32.random(in: 0..<UInt32.max)

    generating = true
    cancelRequested = false

    pipelineQueue.async { [weak self] in
      guard let self = self else { return }

      defer { self.generating = false }

      do {
        var pipelineConfig = PipelineConfiguration(prompt: prompt)
        pipelineConfig.negativePrompt = negativePrompt
        pipelineConfig.stepCount = steps
        pipelineConfig.guidanceScale = Float(guidanceScale)
        pipelineConfig.seed = seed

        let images = try pipe.generateImages(configuration: pipelineConfig) { progress in
          if self.cancelRequested { return false }

          let progressValue = Double(progress.step) / Double(progress.stepCount)
          self.sendEvent(withName: "LocalDreamProgress", body: [
            "step": progress.step,
            "totalSteps": progress.stepCount,
            "progress": progressValue
          ])

          return true // continue
        }

        if self.cancelRequested {
          reject("ERR_CANCELLED", "Generation was cancelled", nil)
          return
        }

        guard let cgImage = images.compactMap({ $0 }).first else {
          reject("ERR_NO_IMAGE", "Pipeline produced no image", nil)
          return
        }

        // Save to app's documents directory
        let imageId = UUID().uuidString
        guard let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
          reject("ERR_NO_DOCS_DIR", "Could not locate documents directory", nil)
          return
        }
        let generatedDir = docsDir.appendingPathComponent("generated_images")
        try FileManager.default.createDirectory(at: generatedDir, withIntermediateDirectories: true)

        let imagePath = generatedDir.appendingPathComponent("\(imageId).png")
        let uiImage = UIImage(cgImage: cgImage)
        guard let pngData = uiImage.pngData() else {
          reject("ERR_ENCODE", "Failed to encode image as PNG", nil)
          return
        }
        try pngData.write(to: imagePath)

        resolve([
          "id": imageId,
          "imagePath": imagePath.path,
          "width": cgImage.width,
          "height": cgImage.height,
          "seed": seed
        ] as [String: Any])

      } catch {
        if !self.cancelRequested {
          self.sendEvent(withName: "LocalDreamError", body: [
            "error": error.localizedDescription
          ])
          reject("ERR_GENERATION", "Image generation failed: \(error.localizedDescription)", error)
        } else {
          reject("ERR_CANCELLED", "Generation was cancelled", nil)
        }
      }
    }
  }

  // MARK: - cancelGeneration

  @objc func cancelGeneration(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    cancelRequested = true
    resolve(true)
  }

  // MARK: - isGenerating

  @objc func isGenerating(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(generating)
  }

  // MARK: - isNpuSupported (always true on Apple Silicon)

  @objc func isNpuSupported(_ resolve: @escaping RCTPromiseResolveBlock,
                            rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve(true)
  }

  // MARK: - getGeneratedImages

  @objc func getGeneratedImages(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
      resolve([])
      return
    }
    let generatedDir = docsDir.appendingPathComponent("generated_images")

    guard let files = try? FileManager.default.contentsOfDirectory(
      at: generatedDir, includingPropertiesForKeys: [.creationDateKey], options: .skipsHiddenFiles
    ) else {
      resolve([])
      return
    }

    let images: [[String: Any]] = files
      .filter { $0.pathExtension == "png" }
      .compactMap { url in
        let id = url.deletingPathExtension().lastPathComponent
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let createdAt = (attrs?[.creationDate] as? Date)?.iso8601String ?? ""

        return [
          "id": id,
          "prompt": "",
          "imagePath": url.path,
          "width": 512,
          "height": 512,
          "steps": 0,
          "seed": 0,
          "modelId": "",
          "createdAt": createdAt
        ] as [String: Any]
      }

    resolve(images)
  }

  // MARK: - deleteGeneratedImage

  @objc func deleteGeneratedImage(_ imageId: String,
                                  resolver resolve: @escaping RCTPromiseResolveBlock,
                                  rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
      reject("ERR_NO_DOCS_DIR", "Could not locate documents directory", nil)
      return
    }
    let imagePath = docsDir
      .appendingPathComponent("generated_images")
      .appendingPathComponent("\(imageId).png")

    do {
      try FileManager.default.removeItem(at: imagePath)
      resolve(true)
    } catch {
      resolve(false)
    }
  }
}

// MARK: - Date helper

private extension Date {
  var iso8601String: String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: self)
  }
}
