import { test, expect } from '@playwright/test';

test.describe('Login flow', () => {
  test('shows login page and logs in as owner', async ({ page }) => {
    await page.goto('/login');

    // Login form is visible
    await expect(page.getByLabel('Business ID')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();

    // Fill in credentials
    await page.getByLabel('Business ID').fill('demo');
    await page.getByLabel('Email').fill('demo@novapos.dev');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Dashboard')).toBeVisible();
  });

  test('rejects wrong credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Business ID').fill('demo');
    await page.getByLabel('Email').fill('demo@novapos.dev');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should stay on login page and show error
    await expect(page).toHaveURL('/login');
  });
});

test.describe('POS register', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Business ID').fill('demo');
    await page.getByLabel('Email').fill('demo@novapos.dev');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.goto('/pos');
  });

  test('shows register with product grid', async ({ page }) => {
    await expect(page.getByText('Register')).toBeVisible();
    // Product grid should load (products exist in seed data)
    await expect(page.locator('[class*="grid"]').first()).toBeVisible();
  });
});

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Business ID').fill('demo');
    await page.getByLabel('Email').fill('demo@novapos.dev');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: /sign in/i }).click();
  });

  test('can navigate to Products page', async ({ page }) => {
    await page.getByRole('link', { name: /products/i }).first().click();
    await expect(page).toHaveURL('/products');
    await expect(page.getByText('Products')).toBeVisible();
  });

  test('can navigate to Orders page', async ({ page }) => {
    await page.getByRole('link', { name: /orders/i }).first().click();
    await expect(page).toHaveURL('/orders');
  });

  test('can navigate to Customers page', async ({ page }) => {
    await page.getByRole('link', { name: /customers/i }).first().click();
    await expect(page).toHaveURL('/customers');
    await expect(page.getByText('Customers')).toBeVisible();
  });

  test('cashier cannot access Settings', async ({ page }) => {
    // Logout and login as cashier
    await page.goto('/login');
    await page.getByLabel('Business ID').fill('demo');
    await page.getByLabel('Email').fill('cashier@novapos.dev');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Attempt to navigate to settings
    await page.goto('/settings');
    // Should be redirected to home (POS register for cashiers)
    await expect(page).toHaveURL('/pos');
  });
});
