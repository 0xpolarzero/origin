import SwiftUI

struct DiagnosticsView: View {
    @Bindable var model: DiagnosticsModel

    var body: some View {
        NavigationStack {
            List {
                Section("Service") {
                    DiagnosticRow(label: "Backend", value: model.backendStatus)
                    DiagnosticRow(label: "PowerSync", value: model.powerSyncStatus)
                    DiagnosticRow(label: "Last sync", value: model.lastSyncTime)
                }

                Section("Identity") {
                    DiagnosticRow(label: "User ID", value: model.userID)
                    DiagnosticRow(label: "Device ID", value: model.deviceID)
                }

                Section("Endpoints") {
                    DiagnosticRow(label: "Backend URL", value: model.backendURL)
                    DiagnosticRow(label: "Correlation ID", value: model.correlationID)
                }

                if !model.lastError.isEmpty {
                    Section("Last Error") {
                        Text(model.lastError)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .textSelection(.enabled)
                    }
                }
            }
            .navigationTitle("Diagnostics")
            .toolbar {
                Button("Refresh") {
                    Task {
                        await model.refresh()
                    }
                }
            }
        }
    }
}

private struct DiagnosticRow: View {
    let label: String
    let value: String

    var body: some View {
        LabeledContent(label) {
            Text(value)
                .font(.system(.body, design: .monospaced))
                .textSelection(.enabled)
                .multilineTextAlignment(.trailing)
        }
    }
}
