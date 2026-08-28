const packagePath = new URL('../ios/App/CapApp-SPM/Package.swift', import.meta.url)

const readiumPackage =
  '        .package(url: "https://github.com/readium/swift-toolkit.git", exact: "3.11.0")'
const readiumProducts = [
  '                .product(name: "ReadiumShared", package: "swift-toolkit")',
  '                .product(name: "ReadiumStreamer", package: "swift-toolkit")',
  '                .product(name: "ReadiumNavigator", package: "swift-toolkit")',
]

const insertBefore = (contents: string, marker: string, addition: string): string => {
  const markerIndex = contents.indexOf(marker)

  if (markerIndex === -1) {
    throw new Error(`Could not find the expected Capacitor package marker: ${marker.trim()}`)
  }

  return `${contents.slice(0, markerIndex)},\n${addition}${contents.slice(markerIndex)}`
}

if (process.env.CAPACITOR_PLATFORM_NAME === 'ios') {
  let packageContents = await Bun.file(packagePath).text()

  if (!packageContents.includes(readiumPackage)) {
    packageContents = insertBefore(
      packageContents,
      '\n    ],\n    targets: [',
      readiumPackage,
    )
  }

  if (readiumProducts.some((product) => !packageContents.includes(product))) {
    const productsToAdd = readiumProducts.filter(
      (product) => !packageContents.includes(product),
    )

    packageContents = insertBefore(
      packageContents,
      '\n            ]\n        )\n    ]\n)',
      productsToAdd.join(',\n'),
    )
  }

  await Bun.write(packagePath, packageContents)
}
