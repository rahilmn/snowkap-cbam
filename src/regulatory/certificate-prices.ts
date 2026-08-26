export type CertificatePricePeriod = "QUARTER" | "WEEK";

export interface CertificatePrice {
  id: string;

  periodType: CertificatePricePeriod;

  periodStart: string;
  periodEnd: string;

  priceEurPerTco2e: string;

  sourceId: string;
}
