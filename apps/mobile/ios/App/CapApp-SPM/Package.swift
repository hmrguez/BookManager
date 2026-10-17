// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0"),
        .package(name: "AparajitaCapacitorSecureStorage", path: "../../../node_modules/@aparajita/capacitor-secure-storage"),
        .package(name: "CapacitorCommunitySqlite", path: "../../../node_modules/@capacitor-community/sqlite"),
        .package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app"),
        .package(name: "CapacitorClipboard", path: "../../../node_modules/@capacitor/clipboard"),
        .package(name: "CapacitorFilesystem", path: "../../../node_modules/@capacitor/filesystem"),
        .package(name: "CapgoCapacitorShareTarget", path: "../../../node_modules/@capgo/capacitor-share-target"),
        .package(url: "https://github.com/readium/swift-toolkit.git", exact: "3.11.0")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "AparajitaCapacitorSecureStorage", package: "AparajitaCapacitorSecureStorage"),
                .product(name: "CapacitorCommunitySqlite", package: "CapacitorCommunitySqlite"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorClipboard", package: "CapacitorClipboard"),
                .product(name: "CapacitorFilesystem", package: "CapacitorFilesystem"),
                .product(name: "CapgoCapacitorShareTarget", package: "CapgoCapacitorShareTarget"),
                .product(name: "ReadiumShared", package: "swift-toolkit"),
                .product(name: "ReadiumStreamer", package: "swift-toolkit"),
                .product(name: "ReadiumNavigator", package: "swift-toolkit")
            ]
        )
    ]
)
