import Foundation
import Observation

@Observable
@MainActor
final class DiagnosticsModel {
    private let backend = BackendClient()
    private let powerSync = PowerSyncDiagnosticsClient()

    var backendURL = BackendClient.defaultBaseURL.absoluteString
    var userID = "dev_user"
    var deviceID = "dev_device"
    var backendStatus = "checking"
    var powerSyncStatus = "checking"
    var lastSyncTime = "never"
    var lastError = ""
    var correlationID = ""

    func refresh() async {
        let requestID = UUID().uuidString

        do {
            let diagnostics = try await backend.fetchDiagnostics(correlationID: requestID)
            backendURL = diagnostics.backendUrl
            userID = diagnostics.userId
            deviceID = diagnostics.deviceId
            backendStatus = diagnostics.status
            correlationID = diagnostics.correlationId

            let sync = await powerSync.connect(
                backendURL: BackendClient.defaultBaseURL,
                deviceID: diagnostics.deviceId,
                correlationID: diagnostics.correlationId
            )
            powerSyncStatus = sync.status
            lastSyncTime = sync.lastSyncTime ?? "pending"
            lastError = sync.lastError ?? ""
        } catch {
            backendStatus = "unhealthy"
            powerSyncStatus = "not_connected"
            lastError = String(describing: error)
            correlationID = requestID
        }
    }
}
