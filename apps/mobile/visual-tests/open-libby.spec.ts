import { expect, test } from '@playwright/test'

for (const fails of [false, true]) {
  test(`Android Libby browser action ${fails ? 'shows a retryable error' : 'uses the native bridge'}`, async ({ page }) => {
    await page.route('**/libby-link-test', route => route.fulfill({ contentType: 'text/html', body: `<html><body><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script></body></html>` }))
    await page.route('**/node_modules/.vite/deps/@capacitor_core.js*', route => route.fulfill({
      contentType: 'application/javascript',
      body: `export const Capacitor = { getPlatform: () => 'android' };
        export const registerPlugin = () => ({ openShelf: async () => {
          document.body.dataset.libbyOpened = 'true';
          ${fails ? "throw new Error('No browser');" : ''}
        } });`,
    }))
    await page.goto('/libby-link-test')
    await page.evaluate(async () => {
      const reactPath = '/node_modules/.vite/deps/react.js'
      const domPath = '/node_modules/.vite/deps/react-dom_client.js'
      const componentPath = '/src/libby/OpenLibbyLink.tsx'
      const { default: React } = await import(/* @vite-ignore */ reactPath)
      const { default: { createRoot } } = await import(/* @vite-ignore */ domPath)
      const { OpenLibbyLink } = await import(/* @vite-ignore */ componentPath)
      const container = document.createElement('div')
      document.body.replaceChildren(container)
      createRoot(container).render(React.createElement(OpenLibbyLink))
    })
    const button = page.getByRole('button', { name: 'Open Libby in browser' })
    await button.click()
    await expect(page.locator('body')).toHaveAttribute('data-libby-opened', 'true')
    await expect(button).toBeEnabled()
    await expect(page.getByRole('link')).toHaveCount(0)
    if (fails) await expect(page.getByRole('alert')).toContainText('Could not open Libby in a browser')
    else await expect(page.getByRole('alert')).toHaveCount(0)
  })
}
