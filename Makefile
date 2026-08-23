SHELL := /bin/bash
.DEFAULT_GOAL := help

IOS_SIMULATOR ?= iPhone 17 Pro
IOS_SDK ?=
ANDROID_TARGET ?=
ANDROID_SDK ?= $(if $(ANDROID_HOME),$(ANDROID_HOME),$(if $(ANDROID_SDK_ROOT),$(ANDROID_SDK_ROOT),$(HOME)/Library/Android/sdk))
ADB := $(if $(wildcard $(ANDROID_SDK)/platform-tools/adb),$(ANDROID_SDK)/platform-tools/adb,adb)

.PHONY: help install dev preview lint build check clean doctor versions sync cap-doctor \
	native-add ios-add android-add ios-open android-open ios-list android-list \
	ios-build android-build android-release ios-simulator android-run \
	android-device android-live android-install android-devices

help: ## Show every available command
	@awk 'BEGIN {FS = ":.*## "; printf "BookManager commands\n\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install exact dependencies from bun.lock
	bun install --frozen-lockfile

dev: ## Start the Vite development server
	bun run dev

preview: ## Preview the production web build
	bun run preview

lint: ## Run Oxlint
	bun run lint

build: ## Type-check and build the web app
	bun run build

check: lint build ## Run all fast project checks

clean: ## Remove generated web and native build output
	rm -rf dist android/app/build ios/DerivedData

doctor: ## Check Bun, Capacitor, Xcode, Android SDK, Java, simulators, and devices
	@./scripts/doctor.sh

versions: ## Print the core tool versions
	@printf 'Bun:        '; bun --version
	@printf 'Vite:       '; bunx vite --version
	@printf 'TypeScript: '; bunx tsc --version
	@printf 'Capacitor:  '; bunx cap --version

sync: build ## Copy the web build and plugins into both native projects
	bunx cap sync

cap-doctor: ## Run Capacitor's own native environment checks
	bunx cap doctor

native-add: ios-add android-add ## Create any missing iOS and Android projects

ios-add: build ## Create the iOS project (safe if it does not exist)
	@test -d ios || bunx cap add ios

android-add: build ## Create the Android project (safe if it does not exist)
	@test -d android || bunx cap add android

ios-open: sync ## Open the native project in Xcode
	bunx cap open ios

android-open: sync ## Open the native project in Android Studio
	bunx cap open android

ios-list: ## List available iOS devices and simulators
	bunx cap run ios --list

android-list: ## List available Android devices and emulators
	bunx cap run android --list

ios-build: sync ## Build a Debug app for the selected iOS Simulator
	xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS Simulator,name=$(IOS_SIMULATOR),OS=latest' -derivedDataPath ios/DerivedData build

android-build: sync ## Build an Android debug APK
	cd android && ./gradlew assembleDebug

android-release: sync ## Build an unsigned Android release APK
	cd android && ./gradlew assembleRelease

ios-simulator: ios-build ## Build, install, and launch on IOS_SIMULATOR (optional IOS_SDK)
	@IOS_SIMULATOR="$(IOS_SIMULATOR)" IOS_SDK="$(IOS_SDK)" ./scripts/run-ios-simulator.sh

android-run: sync ## Interactively choose an Android device/emulator and run
	bunx cap run android --no-sync

android-device: sync ## Run on ANDROID_TARGET (use `make android-devices` to find it)
	@test -n "$(ANDROID_TARGET)" || (echo 'Set ANDROID_TARGET, e.g. make android-device ANDROID_TARGET=YOUR_SERIAL' && exit 1)
	bunx cap run android --target "$(ANDROID_TARGET)" --no-sync

android-live: ## Run Android with Vite live reload (set ANDROID_TARGET to skip selection)
	@if [ -n "$(ANDROID_TARGET)" ]; then \
		bunx cap run android --target "$(ANDROID_TARGET)" --live-reload --forwardPorts 5173:5173; \
	else \
		bunx cap run android --live-reload --forwardPorts 5173:5173; \
	fi

android-install: android-build ## Install the debug APK on the connected Pixel/device
	$(ADB) install -r android/app/build/outputs/apk/debug/app-debug.apk

android-devices: ## Show ADB device serials and authorization state
	$(ADB) devices -l
