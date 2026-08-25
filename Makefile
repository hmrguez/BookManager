SHELL := /bin/bash
.DEFAULT_GOAL := help

MOBILE_DIR := apps/mobile
IOS_SIMULATOR ?= iPhone 17 Pro
IOS_SDK ?=
ANDROID_TARGET ?=
ANDROID_SDK ?= $(if $(ANDROID_HOME),$(ANDROID_HOME),$(if $(ANDROID_SDK_ROOT),$(ANDROID_SDK_ROOT),$(HOME)/Library/Android/sdk))
ADB := $(if $(wildcard $(ANDROID_SDK)/platform-tools/adb),$(ANDROID_SDK)/platform-tools/adb,adb)
BRAND_SOURCE_PNG ?= branding/source/wovenleaf-mark-color-2048px.png
BRAND_SOURCE_SVG ?= branding/source/wovenleaf-mark-color.svg
BRAND_LOCAL_OUTPUT ?= branding/final/platform

.PHONY: help install dev gallery gallery-test preview lint test build check clean doctor versions brand-assets sync cap-doctor \
	native-add ios-add android-add ios-open android-open ios-list android-list \
	ios-build android-build android-release ios-simulator android-run \
	android-device android-live android-install android-devices

help: ## Show every available command
	@awk 'BEGIN {FS = ":.*## "; printf "Wovenleaf commands\n\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install exact dependencies from bun.lock
	cd $(MOBILE_DIR) && bun install --frozen-lockfile

dev: ## Start the Vite development server
	cd $(MOBILE_DIR) && bun run dev

gallery: ## Open the development-only Pulp component gallery
	cd $(MOBILE_DIR) && bun run gallery

gallery-test: ## Compare the deterministic component screenshots
	cd $(MOBILE_DIR) && bun run gallery:test

preview: ## Preview the production web build
	cd $(MOBILE_DIR) && bun run preview

lint: ## Run Oxlint
	cd $(MOBILE_DIR) && bun run lint

build: ## Type-check and build the web app
	cd $(MOBILE_DIR) && bun run build

test: ## Run unit tests
	cd $(MOBILE_DIR) && bun run test

check: lint test build ## Run all fast project checks

clean: ## Remove generated web and native build output
	rm -rf $(MOBILE_DIR)/dist $(MOBILE_DIR)/android/app/build $(MOBILE_DIR)/ios/DerivedData

doctor: ## Check Bun, Capacitor, Xcode, Android SDK, Java, simulators, and devices
	@cd $(MOBILE_DIR) && ./scripts/doctor.sh

versions: ## Print the core tool versions
	@printf 'Bun:        '; cd $(MOBILE_DIR) && bun --version
	@printf 'Vite:       '; cd $(MOBILE_DIR) && bunx vite --version
	@printf 'TypeScript: '; cd $(MOBILE_DIR) && bunx tsc --version
	@printf 'Capacitor:  '; cd $(MOBILE_DIR) && bunx cap --version

brand-assets: ## Regenerate and validate iOS, Android, web, splash, and store artwork
	uv run --no-project --with-requirements $(MOBILE_DIR)/scripts/brand-assets-requirements.txt \
		$(MOBILE_DIR)/scripts/generate-brand-assets.py \
		--source-png $(BRAND_SOURCE_PNG) \
		--source-svg $(BRAND_SOURCE_SVG) \
		--local-output $(BRAND_LOCAL_OUTPUT)

sync: build ## Copy the web build and plugins into both native projects
	cd $(MOBILE_DIR) && bunx cap sync

cap-doctor: ## Run Capacitor's own native environment checks
	cd $(MOBILE_DIR) && bunx cap doctor

native-add: ios-add android-add ## Create any missing iOS and Android projects

ios-add: build ## Create the iOS project (safe if it does not exist)
	@cd $(MOBILE_DIR) && { test -d ios || bunx cap add ios; }

android-add: build ## Create the Android project (safe if it does not exist)
	@cd $(MOBILE_DIR) && { test -d android || bunx cap add android; }

ios-open: sync ## Open the native project in Xcode
	cd $(MOBILE_DIR) && bunx cap open ios

android-open: sync ## Open the native project in Android Studio
	cd $(MOBILE_DIR) && bunx cap open android

ios-list: ## List available iOS devices and simulators
	cd $(MOBILE_DIR) && bunx cap run ios --list

android-list: ## List available Android devices and emulators
	cd $(MOBILE_DIR) && bunx cap run android --list

ios-build: sync ## Build a Debug app for the selected iOS Simulator
	cd $(MOBILE_DIR) && xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS Simulator,name=$(IOS_SIMULATOR),OS=latest' -derivedDataPath ios/DerivedData build

android-build: sync ## Build an Android debug APK
	cd $(MOBILE_DIR)/android && ./gradlew assembleDebug

android-release: sync ## Build an unsigned Android release APK
	cd $(MOBILE_DIR)/android && ./gradlew assembleRelease

ios-simulator: ios-build ## Build, install, and launch on IOS_SIMULATOR (optional IOS_SDK)
	@cd $(MOBILE_DIR) && IOS_SIMULATOR="$(IOS_SIMULATOR)" IOS_SDK="$(IOS_SDK)" ./scripts/run-ios-simulator.sh

android-run: sync ## Interactively choose an Android device/emulator and run
	cd $(MOBILE_DIR) && bunx cap run android --no-sync

android-device: sync ## Run on ANDROID_TARGET (use `make android-devices` to find it)
	@test -n "$(ANDROID_TARGET)" || (echo 'Set ANDROID_TARGET, e.g. make android-device ANDROID_TARGET=YOUR_SERIAL' && exit 1)
	cd $(MOBILE_DIR) && bunx cap run android --target "$(ANDROID_TARGET)" --no-sync

android-live: ## Run Android with Vite live reload (set ANDROID_TARGET to skip selection)
	@cd $(MOBILE_DIR) && if [ -n "$(ANDROID_TARGET)" ]; then \
		bunx cap run android --target "$(ANDROID_TARGET)" --live-reload --forwardPorts 5173:5173; \
	else \
		bunx cap run android --live-reload --forwardPorts 5173:5173; \
	fi

android-install: android-build ## Install the debug APK on the connected Pixel/device
	$(ADB) install -r $(MOBILE_DIR)/android/app/build/outputs/apk/debug/app-debug.apk

android-devices: ## Show ADB device serials and authorization state
	$(ADB) devices -l
