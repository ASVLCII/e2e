import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test.describe('toasts', { tags: ['toasts'] }, () => {
  test.beforeEach(async ({ app }) => {
    await app.open('/toasts');
  });

  test('reads a sonner toast by text and region until it dismisses', async ({ screen }) => {
    const projectName = screen.getByLabel('Project Name');
    await projectName.fill('x'.repeat(300));
    await screen.getByRole('button', { name: 'Save Changes' }).tap();

    const toast = screen.getByText('Failed to update project');
    await expect(toast).toBeVisible();
    const notifications = screen.getByRole('region', { name: /^Notifications/ });
    await expect(notifications.getByRole('listitem')).toHaveText('Failed to update project');
    // A sonner toast carries no role of its own: the live region is a named section.
    await expect(screen.getByRole('status')).toHaveCount(0);

    await expect(projectName).toHaveAttribute('aria-invalid', 'false');
    await expect(toast).toBeHidden({ timeout: 10_000 });
  });
});
