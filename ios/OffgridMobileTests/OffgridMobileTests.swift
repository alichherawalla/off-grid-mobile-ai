import XCTest
import PDFKit

@testable import OffgridMobile

// MARK: - PDFExtractorModule Tests

final class PDFExtractorModuleTests: XCTestCase {

  private var module: PDFExtractorModule!

  override func setUp() {
    super.setUp()
    module = PDFExtractorModule()
  }

  /// Creates a single-page PDF containing `text` and returns a file URL in the temp directory.
  private func makeTempPDF(text: String) -> URL {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString + ".pdf")
    let renderer = UIGraphicsPDFRenderer(bounds: CGRect(x: 0, y: 0, width: 612, height: 792))
    let data = renderer.pdfData { ctx in
      ctx.beginPage()
      let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 12)]
      text.draw(in: CGRect(x: 72, y: 72, width: 468, height: 648), withAttributes: attrs)
    }
    try! data.write(to: url)
    return url
  }

  func testExtractTextResolvesWithContent() {
    let url = makeTempPDF(text: "Hello, PDF World!")
    let exp = expectation(description: "resolve")

    module.extractText(
      url.absoluteString,
      maxChars: 10_000,
      resolver: { result in
        XCTAssertNotNil(result)
        exp.fulfill()
      },
      rejecter: { _, _, _ in
        XCTFail("extractText should not reject a valid PDF")
        exp.fulfill()
      }
    )

    waitForExpectations(timeout: 5)
    try? FileManager.default.removeItem(at: url)
  }

  func testExtractTextTruncatesAtMaxChars() {
    let longText = String(repeating: "A", count: 300)
    let url = makeTempPDF(text: longText)
    let exp = expectation(description: "truncate")

    module.extractText(
      url.absoluteString,
      maxChars: 50,
      resolver: { result in
        let text = (result as? String) ?? ""
        XCTAssertTrue(
          text.contains("... [Extracted"),
          "Truncated text should contain page marker, got: \(text.prefix(120))"
        )
        exp.fulfill()
      },
      rejecter: { _, _, _ in
        XCTFail("extractText should not reject")
        exp.fulfill()
      }
    )

    waitForExpectations(timeout: 5)
    try? FileManager.default.removeItem(at: url)
  }

  func testExtractTextRejectsInvalidPath() {
    let exp = expectation(description: "reject invalid path")

    module.extractText(
      "/nonexistent/path/file.pdf",
      maxChars: 10_000,
      resolver: { _ in
        XCTFail("extractText should reject a non-existent file")
        exp.fulfill()
      },
      rejecter: { code, _, _ in
        XCTAssertEqual(code, "PDF_ERROR")
        exp.fulfill()
      }
    )

    waitForExpectations(timeout: 5)
  }
}

// MARK: - CoreMLDiffusionModule Tests

final class CoreMLDiffusionModuleTests: XCTestCase {

  private var module: CoreMLDiffusionModule!

  override func setUp() {
    super.setUp()
    module = CoreMLDiffusionModule()
  }

  func testSupportedEvents() {
    let events = module.supportedEvents()!
    XCTAssertTrue(events.contains("LocalDreamProgress"))
    XCTAssertTrue(events.contains("LocalDreamError"))
    XCTAssertEqual(events.count, 2)
  }

  func testIsNpuSupportedReturnsTrue() {
    let exp = expectation(description: "isNpuSupported")
    module.isNpuSupported(
      { value in
        XCTAssertEqual(value as? Bool, true)
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  func testIsGeneratingReturnsFalseInitially() {
    let exp = expectation(description: "isGenerating")
    module.isGenerating(
      { value in
        XCTAssertEqual(value as? Bool, false)
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  func testIsModelLoadedReturnsFalseInitially() {
    let exp = expectation(description: "isModelLoaded")
    module.isModelLoaded(
      { value in
        XCTAssertEqual(value as? Bool, false)
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }

  func testCancelGenerationSucceeds() {
    let exp = expectation(description: "cancelGeneration")
    module.cancelGeneration(
      { value in
        XCTAssertEqual(value as? Bool, true)
        exp.fulfill()
      },
      rejecter: { _, _, _ in XCTFail("unexpected reject"); exp.fulfill() }
    )
    waitForExpectations(timeout: 2)
  }
}

// MARK: - DownloadManagerModule Tests

final class DownloadManagerModuleTests: XCTestCase {

  private var module: DownloadManagerModule!

  override func setUp() {
    super.setUp()
    module = DownloadManagerModule()
  }

  func testSupportedEventsContainsAllExpectedEvents() {
    let events = module.supportedEvents()!
    XCTAssertTrue(events.contains("DownloadProgress"))
    XCTAssertTrue(events.contains("DownloadComplete"))
    XCTAssertTrue(events.contains("DownloadError"))
    XCTAssertEqual(events.count, 3)
  }
}
