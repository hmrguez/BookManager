import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var privacyShield: UIView?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = WovenleafBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        guard privacyShield == nil, let window else { return }

        let shield = UIView(frame: window.bounds)
        shield.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        shield.backgroundColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.055, green: 0.059, blue: 0.051, alpha: 1)
                : UIColor(red: 0.965, green: 0.949, blue: 0.902, alpha: 1)
        }

        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "Wovenleaf"
        title.font = .preferredFont(forTextStyle: .headline)
        title.textColor = UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.902, green: 0.875, blue: 0.784, alpha: 1)
                : UIColor(red: 0.137, green: 0.125, blue: 0.102, alpha: 1)
        }
        shield.addSubview(title)
        NSLayoutConstraint.activate([
            title.centerXAnchor.constraint(equalTo: shield.centerXAnchor),
            title.centerYAnchor.constraint(equalTo: shield.centerYAnchor),
        ])

        window.addSubview(shield)
        privacyShield = shield
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        privacyShield?.removeFromSuperview()
        privacyShield = nil
    }
}
