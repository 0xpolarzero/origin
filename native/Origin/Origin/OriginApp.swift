import SwiftUI

@main
struct OriginApp: App {
    @State private var model = DiagnosticsModel()

    var body: some Scene {
        WindowGroup {
            DiagnosticsView(model: model)
                .task {
                    await model.refresh()
                }
        }
    }
}
