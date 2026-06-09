import Foundation

struct BackendDiagnostics: Decodable {
    let backendUrl: String
    let correlationId: String
    let deviceId: String
    let powersyncUrl: String
    let status: String
    let userId: String
}

struct PowerSyncCredentialEnvelope: Decodable {
    let endpoint: String
    let token: String
}

struct BackendClient {
    static let defaultBaseURL = URL(string: "http://127.0.0.1:3000")!

    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL = BackendClient.defaultBaseURL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func fetchDiagnostics(correlationID: String) async throws -> BackendDiagnostics {
        var request = URLRequest(url: baseURL.appending(path: "/v1/diagnostics"))
        request.setValue(correlationID, forHTTPHeaderField: "x-correlation-id")
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(BackendDiagnostics.self, from: data)
    }

    func fetchPowerSyncCredentials(deviceID: String, correlationID: String) async throws -> PowerSyncCredentialEnvelope {
        var request = URLRequest(url: baseURL.appending(path: "/v1/powersync/credentials"))
        request.httpMethod = "POST"
        request.setValue(deviceID, forHTTPHeaderField: "x-device-id")
        request.setValue(correlationID, forHTTPHeaderField: "x-correlation-id")
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(PowerSyncCredentialEnvelope.self, from: data)
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw BackendClientError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw BackendClientError.httpStatus(http.statusCode, body)
        }
    }
}

enum BackendClientError: LocalizedError {
    case httpStatus(Int, String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .httpStatus(let status, let body):
            return "HTTP \(status): \(body)"
        case .invalidResponse:
            return "Invalid backend response"
        }
    }
}
