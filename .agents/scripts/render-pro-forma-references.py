from pathlib import Path
import fitz
import zipfile
out = Path(".agents/outputs/pro-forma")
out.mkdir(parents=True, exist_ok=True)
for label, file in [
    ("us", "attached_assets/400494_0812_Advance_Invoice_1791297096162.pdf"),
    ("uk", "attached_assets/Kilwaughter_Minerals_Limited_-_Proforma_Invoice_-_P_10346_1791297096163.pdf"),
]:
    doc = fitz.open(file)
    doc[0].get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(out / f"{label}-reference.png")
with zipfile.ZipFile("attached_assets/ProposalInvoice_for_service_prepayment_1791297096164.docx") as z:
    for name in z.namelist():
        if name.startswith("word/media/"):
            (out / Path(name).name).write_bytes(z.read(name))
