import XCTest

final class OriginUITests: XCTestCase {
    func testDiagnosticsScreenIsLaunchScreen() {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.navigationBars["Diagnostics"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Backend"].exists)
        XCTAssertTrue(app.staticTexts["PowerSync"].exists)
        XCTAssertTrue(app.staticTexts["User ID"].exists)
        XCTAssertTrue(app.staticTexts["Device ID"].exists)
    }
}
