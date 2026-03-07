import XCTest

@testable import OffgridMobile

// MARK: - Embedding Model Bundle Tests

/// Verifies that the embedding model GGUF file is correctly bundled
/// in the iOS app's main bundle and accessible at runtime.
final class EmbeddingModelBundleTests: XCTestCase {

  private let modelFileName = "all-MiniLM-L6-v2-Q8_0"
  private let modelExtension = "gguf"

  // MARK: Bundle presence

  func testEmbeddingModelExistsInBundle() {
    let path = Bundle.main.path(forResource: modelFileName, ofType: modelExtension)
    XCTAssertNotNil(
      path,
      "Embedding model \(modelFileName).\(modelExtension) must be present in the app bundle"
    )
  }

  func testEmbeddingModelFileIsNotEmpty() {
    guard let path = Bundle.main.path(forResource: modelFileName, ofType: modelExtension) else {
      XCTFail("Model file not found in bundle")
      return
    }

    let fileManager = FileManager.default
    guard let attrs = try? fileManager.attributesOfItem(atPath: path),
          let size = attrs[.size] as? Int else {
      XCTFail("Could not read file attributes")
      return
    }

    XCTAssertGreaterThan(size, 1_000_000, "Embedding model should be at least 1MB (got \(size) bytes)")
  }

  func testEmbeddingModelHasGGUFMagicBytes() {
    guard let path = Bundle.main.path(forResource: modelFileName, ofType: modelExtension) else {
      XCTFail("Model file not found in bundle")
      return
    }

    guard let handle = FileHandle(forReadingAtPath: path) else {
      XCTFail("Could not open model file for reading")
      return
    }
    defer { handle.closeFile() }

    // GGUF files start with magic bytes "GGUF" (0x46475547 little-endian)
    let magic = handle.readData(ofLength: 4)
    XCTAssertEqual(magic.count, 4, "Should read 4 magic bytes")

    let magicString = String(data: magic, encoding: .ascii)
    XCTAssertEqual(magicString, "GGUF", "File should start with GGUF magic bytes")
  }

  // MARK: Copyability

  func testEmbeddingModelCanBeCopiedToDocumentsDir() {
    guard let sourcePath = Bundle.main.path(forResource: modelFileName, ofType: modelExtension) else {
      XCTFail("Model file not found in bundle")
      return
    }

    let fileManager = FileManager.default
    let docsDir = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first!
    let destURL = docsDir.appendingPathComponent("\(modelFileName).\(modelExtension)")

    // Clean up first
    try? fileManager.removeItem(at: destURL)

    do {
      try fileManager.copyItem(atPath: sourcePath, toPath: destURL.path)
      XCTAssertTrue(fileManager.fileExists(atPath: destURL.path))

      // Verify copied file is same size
      let sourceAttrs = try fileManager.attributesOfItem(atPath: sourcePath)
      let destAttrs = try fileManager.attributesOfItem(atPath: destURL.path)
      XCTAssertEqual(
        sourceAttrs[.size] as? Int,
        destAttrs[.size] as? Int,
        "Copied file size should match source"
      )
    } catch {
      XCTFail("Failed to copy embedding model: \(error)")
    }

    // Clean up
    try? fileManager.removeItem(at: destURL)
  }
}
