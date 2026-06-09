import Foundation

struct SyncProbe {
    let status: String
    let lastSyncTime: String?
    let lastError: String?
}

actor PowerSyncDiagnosticsClient {
    private let backend = BackendClient()

    func connect(backendURL: URL, deviceID: String, correlationID: String) async -> SyncProbe {
        do {
            let credentials = try await backend.fetchPowerSyncCredentials(deviceID: deviceID, correlationID: correlationID)
            guard let endpoint = URL(string: credentials.endpoint) else {
                return SyncProbe(status: "not_connected", lastSyncTime: nil, lastError: "Invalid PowerSync endpoint")
            }

            var request = URLRequest(url: endpoint)
            request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
            let (_, response) = try await URLSession.shared.data(for: request)
            guard response is HTTPURLResponse else {
                return SyncProbe(status: "not_connected", lastSyncTime: nil, lastError: "Invalid PowerSync response")
            }

            return SyncProbe(status: "reachable", lastSyncTime: "not_synced", lastError: nil)
        } catch {
            return SyncProbe(status: "not_connected", lastSyncTime: nil, lastError: String(describing: error))
        }
    }
}
