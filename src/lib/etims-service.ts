// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — KRA eTIMS Service (Mock Implementation)
// ─────────────────────────────────────────────────────────────────────────────
//
// Service for Kenya Revenue Authority eTIMS API integration.
// This is a mock implementation that simulates KRA API responses.
// In production, replace the mock calls with actual KRA eTIMS API requests.
// ─────────────────────────────────────────────────────────────────────────────

import { formatEtimsDate, generateInvoiceNumber, validateKraPin, buildQrCodePayload } from './etims-utils';

export interface EtimsConfig {
  baseUrl: string;
  bvsn: string;
  tin: string;
  branchId: string;
  deviceSerial: string;
  sandbox: boolean;
}

export interface EtimsProduct {
  productId: string;
  name: string;
  description?: string;
  price: number;
  taxType: string;
  unit: string;
  categoryCode?: string;
}

export interface EtimsInvoice {
  invoiceNumber: string;
  date: Date;
  customerTin?: string;
  customerName: string;
  items: Array<{
    itemCode: string;
    name: string;
    quantity: number;
    price: number;
    taxRate: number;
    discount?: number;
  }>;
  payments: Array<{
    method: string;
    amount: number;
    reference?: string;
  }>;
  totalAmount: number;
  vatAmount: number;
}

export interface EtimsInvoiceResponse {
  invoiceNumber: string;
  qrCode: string;
  url: string;
  status: 'ISSUED' | 'PENDING' | 'FAILED';
  issuedAt: Date;
}

export interface EtimsProductResponse {
  itemCode: string;
  status: 'REGISTERED' | 'PENDING' | 'FAILED';
  registeredAt: Date;
}

/**
 * Initialize an eTIMS client with the given configuration.
 */
export function initializeEtimsClient(config: EtimsConfig) {
  return {
    config,
    isSandbox: config.sandbox,

    async registerProduct(product: EtimsProduct): Promise<EtimsProductResponse> {
      console.info('[eTIMS] Registering product:', product.productId);
      // Mock: generate a deterministic item code
      const itemCode = `ITEM${product.productId.slice(-8).toUpperCase()}`;
      return {
        itemCode,
        status: 'REGISTERED',
        registeredAt: new Date(),
      };
    },

    async issueInvoice(invoice: EtimsInvoice): Promise<EtimsInvoiceResponse> {
      console.info('[eTIMS] Issuing invoice:', invoice.invoiceNumber);
      const qrData = buildQrCodePayload({
        invoiceNumber: invoice.invoiceNumber,
        tin: config.tin,
        date: invoice.date,
        totalAmount: invoice.totalAmount,
        vatAmount: invoice.vatAmount,
        customerTin: invoice.customerTin,
      });
      return {
        invoiceNumber: invoice.invoiceNumber,
        qrCode: qrData,
        url: `https://etims.kra.go.ke/verify/${invoice.invoiceNumber}`,
        status: 'ISSUED',
        issuedAt: new Date(),
      };
    },

    async cancelInvoice(invoiceNumber: string, _reason: string): Promise<{ success: boolean }> {
      console.info('[eTIMS] Cancelling invoice:', invoiceNumber);
      return { success: true };
    },

    async getInvoiceStatus(_invoiceNumber: string): Promise<{ status: string }> {
      return { status: 'ISSUED' };
    },

    async customerSearch(tin: string): Promise<{ tin: string; name: string; address?: string } | null> {
      if (!validateKraPin(tin)) return null;
      // Mock customer lookup
      return {
        tin: tin.toUpperCase(),
        name: 'Verified KRA Taxpayer',
      };
    },

    async stockMasterReport(): Promise<{ success: boolean; reportUrl?: string }> {
      return { success: true };
    },

    async branchInfo(): Promise<{ branchId: string; branchName: string; status: string }> {
      return {
        branchId: config.branchId,
        branchName: 'MBUMAH HARDWARE',
        status: 'ACTIVE',
      };
    },

    async testConnection(): Promise<{ success: boolean; message: string }> {
      return {
        success: true,
        message: config.sandbox
          ? 'Sandbox connection successful'
          : 'Production connection successful',
      };
    },
  };
}

/**
 * Get eTIMS configuration from environment variables.
 */
export function getEtimsConfig(): EtimsConfig {
  return {
    baseUrl: process.env.ETIMS_API_URL || 'https://etims-api-sbx.kra.go.ke',
    bvsn: process.env.ETIMS_BVSN || '',
    tin: process.env.ETIMS_TIN || process.env.KRA_PIN || '',
    branchId: process.env.ETIMS_BRANCH_ID || '',
    deviceSerial: process.env.ETIMS_DEVICE_SERIAL || '',
    sandbox: process.env.ETIMS_SANDBOX !== 'false',
  };
}

export { formatEtimsDate, generateInvoiceNumber, validateKraPin };
