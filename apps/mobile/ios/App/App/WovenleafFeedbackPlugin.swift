import AVFoundation
import Capacitor
import CoreHaptics
import UIKit

@objc(WovenleafFeedbackPlugin)
final class WovenleafFeedbackPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "WovenleafFeedbackPlugin"
    let jsName = "WovenleafFeedback"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "emit", returnType: CAPPluginReturnPromise),
    ]

    private let selectionFeedback = UISelectionFeedbackGenerator()
    private let softImpactFeedback = UIImpactFeedbackGenerator(style: .soft)
    private let rigidImpactFeedback = UIImpactFeedbackGenerator(style: .rigid)
    private let notificationFeedback = UINotificationFeedbackGenerator()
    private var audioPlayers: [String: AVAudioPlayer] = [:]
    private var activeAudioPlayer: AVAudioPlayer?

    override func load() {
        super.load()
        prepareFeedback()
        prepareSounds()
    }

    @objc func getCapabilities(_ call: CAPPluginCall) {
        call.resolve([
            "platform": "ios",
            "haptics": CHHapticEngine.capabilitiesForHardware().supportsHaptics,
            "sound": true,
        ])
    }

    @objc func emit(_ call: CAPPluginCall) {
        guard let event = call.getString("event"), Self.events.contains(event) else {
            call.reject("The feedback event is invalid.", "INVALID_FEEDBACK")
            return
        }
        let hapticsEnabled = call.getBool("haptics") ?? false
        let soundEnabled = call.getBool("sound") ?? false
        let soundProfile = call.getString("soundProfile") ?? "semantic"

        DispatchQueue.main.async {
            let hapticPlayed = hapticsEnabled && self.playHaptic(event)
            let soundPlayed = soundEnabled && self.playSound(event, profile: soundProfile)
            call.resolve([
                "hapticPlayed": hapticPlayed,
                "soundPlayed": soundPlayed,
            ])
        }
    }

    private func prepareFeedback() {
        selectionFeedback.prepare()
        softImpactFeedback.prepare()
        rigidImpactFeedback.prepare()
        notificationFeedback.prepare()
    }

    private func playHaptic(_ event: String) -> Bool {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return false }
        switch event {
        case "selection":
            selectionFeedback.selectionChanged()
            selectionFeedback.prepare()
        case "successful-move":
            softImpactFeedback.impactOccurred(intensity: 0.72)
            softImpactFeedback.prepare()
        case "boundary":
            rigidImpactFeedback.impactOccurred(intensity: 0.82)
            rigidImpactFeedback.prepare()
        case "completion":
            notificationFeedback.notificationOccurred(.success)
            notificationFeedback.prepare()
        case "error":
            notificationFeedback.notificationOccurred(.error)
            notificationFeedback.prepare()
        default:
            return false
        }
        return true
    }

    private func prepareSounds() {
        for filename in Set(Self.semanticSounds.values).union(["shelf-transfer.wav"]) {
            let url = Bundle.main.bundleURL
                .appendingPathComponent("public", isDirectory: true)
                .appendingPathComponent("feedback", isDirectory: true)
                .appendingPathComponent(filename)
            guard FileManager.default.fileExists(atPath: url.path) else { continue }
            guard let player = try? AVAudioPlayer(contentsOf: url) else { continue }
            player.numberOfLoops = 0
            player.volume = 1
            player.prepareToPlay()
            audioPlayers[filename] = player
        }
    }

    private func playSound(_ event: String, profile: String) -> Bool {
        guard UIApplication.shared.applicationState == .active else { return false }
        guard !UIAccessibility.isVoiceOverRunning, !UIAccessibility.isSwitchControlRunning else { return false }
        guard !wovenleafPlaybackSuppressesInterfaceSounds() else { return false }

        let filename = profile == "shelf-transfer" && event == "successful-move"
            ? "shelf-transfer.wav"
            : Self.semanticSounds[event]
        guard let filename, let player = audioPlayers[filename] else { return false }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.ambient, mode: .default)
            try session.setActive(true)
        } catch {
            return false
        }

        activeAudioPlayer?.stop()
        player.currentTime = 0
        activeAudioPlayer = player
        return player.play()
    }

    private static let events: Set<String> = [
        "selection",
        "successful-move",
        "boundary",
        "completion",
        "error",
    ]

    private static let semanticSounds: [String: String] = [
        "selection": "graphite-tick.wav",
        "successful-move": "paper-slide.wav",
        "boundary": "paper-edge.wav",
        "completion": "page-settle.wav",
        "error": "soft-error.wav",
    ]
}
