import type { ProFormaPreview } from "@workspace/api-client-react";

function filenamePart(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_").replace(/[. ]+$/g, "");
}

export function invoiceFilename(preview: Pick<ProFormaPreview, "header" | "serviceOrderNumber">): string {
  const account = filenamePart(preview.header.account_name);
  const po = filenamePart(preview.header.ponumber);
  const reference = filenamePart(preview.serviceOrderNumber);
  return `ProformaInvoice_${account}(${po})_${reference}.pdf`;
}
