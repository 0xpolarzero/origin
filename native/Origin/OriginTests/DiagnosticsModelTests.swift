import XCTest
@testable import Origin

final class DiagnosticsModelTests: XCTestCase {
    func testInitialDiagnosticsStateUsesDevelopmentIdentity() {
        let model = DiagnosticsModel()

        XCTAssertEqual(model.userID, "dev_user")
        XCTAssertEqual(model.deviceID, "dev_device")
        XCTAssertEqual(model.backendStatus, "checking")
        XCTAssertEqual(model.powerSyncStatus, "checking")
    }
}
