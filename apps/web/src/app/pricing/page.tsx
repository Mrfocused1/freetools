import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { TIERS } from "@/lib/tiers";
import { CheckoutButton } from "./CheckoutButton";

export default function PricingPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-6xl px-6 py-20">
        <header className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight">Pricing</h1>
          <p className="mt-3 text-[var(--color-muted)]">
            Start free. Upgrade when you need more images or bigger files.
          </p>
        </header>

        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {(Object.keys(TIERS) as Array<keyof typeof TIERS>).map((key) => {
            const t = TIERS[key];
            return (
              <div
                key={key}
                className={`rounded-2xl border p-6 ${
                  key === "pro"
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                    : "border-[var(--color-border)] bg-[var(--color-surface)]"
                }`}
              >
                <p className="text-sm text-[var(--color-muted)]">{t.name}</p>
                <p className="mt-2 text-4xl font-semibold">
                  ${t.monthlyPriceUsd}
                  <span className="text-sm font-normal text-[var(--color-muted)]">/mo</span>
                </p>
                <ul className="mt-6 space-y-2 text-sm">
                  <li>{t.monthlyImages.toLocaleString()} images / month</li>
                  <li>Max input: {t.maxInputDimension}×{t.maxInputDimension}</li>
                  <li>
                    Output: {t.maxOutputDimension === 0 ? "full resolution" : `${t.maxOutputDimension}px max`}
                  </li>
                  <li>Batch: up to {t.batchSize}</li>
                  <li>
                    Model: {" "}
                    {t.model === "birefnet"
                      ? "BiRefNet"
                      : t.model === "birefnet-2k"
                        ? "BiRefNet 2K"
                        : "BiRefNet + ViTMatte refinement"}
                  </li>
                  <li>
                    API: {t.apiAccess === "none" ? "—" : t.apiAccess === "basic" ? "Basic" : "Full + webhooks"}
                  </li>
                </ul>
                <div className="mt-8">
                  <CheckoutButton tier={key} />
                </div>
              </div>
            );
          })}
        </div>

        <section className="mt-20 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
          <h2 className="text-xl font-semibold">Need more? Credit packs.</h2>
          <p className="mt-2 text-[var(--color-muted)]">
            Buy extra images any time — they stack on top of your plan and never expire.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <CreditCard label="100 credits" price="$5" priceKey="small" />
            <CreditCard label="1,000 credits" price="$40" priceKey="large" />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function CreditCard({ label, price, priceKey }: { label: string; price: string; priceKey: "small" | "large" }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-[var(--color-muted)]">One-time purchase</p>
      </div>
      <div className="flex items-center gap-4">
        <p className="text-xl font-semibold">{price}</p>
        <CheckoutButton credits={priceKey} />
      </div>
    </div>
  );
}
