// Programmatic SEO — one entry per targeted search term.
// Kept intentionally data-only so /use-case/[slug] can render any of them.

export type UseCase = {
  slug: string;
  tool?: "bg-remove" | "upscale";   // which dropzone to embed (default bg-remove)
  title: string;
  h1: string;
  subhead: string;
  intro: string;           // 1 paragraph, 2-3 sentences
  bullets: string[];       // 3-4 benefit bullets
  howTo: string[];         // 4-5 step list
  faqs: { q: string; a: string }[];
  keywords: string[];
};

export const USE_CASES: UseCase[] = [
  {
    slug: "remove-background-from-portrait",
    title: "Remove Background From a Portrait | Quick Fix",
    h1: "Remove background from a portrait photo",
    subhead: "Preserve every hair strand, even the wispy ones.",
    intro:
      "Quick Fix uses BiRefNet-matting — a state-of-the-art open-source AI model fine-tuned specifically for portrait matting. That means the semi-transparent values around flyaway hair and soft collars come out clean, not chopped.",
    bullets: [
      "Pixel-perfect alpha on hair, fringes, and soft fabric",
      "Works with phone photos, DSLR shots, and studio portraits",
      "Download as a transparent PNG or on any solid colour",
      "Free for the first 20 images a month, no sign-up required",
    ],
    howTo: [
      "Drop your portrait photo, paste an image URL, or press ⌘V.",
      "Turn on \"Fine hair & edges\" for portraits with frizzy or wispy hair.",
      "Wait 30-60 seconds while the AI processes.",
      "Pick a background colour or keep it transparent.",
      "Download the PNG at full resolution.",
    ],
    faqs: [
      {
        q: "Will it preserve fine hair?",
        a: "Yes — the BiRefNet-matting model is specifically trained to produce proper semi-transparent values for hair. Turn on the \"Fine hair & edges\" toggle for the best result.",
      },
      {
        q: "What file formats can I upload?",
        a: "JPG, PNG, and WebP up to 20 MB. Output is always a PNG with alpha.",
      },
      {
        q: "Do you keep my photo?",
        a: "No. All input and output images are auto-deleted within an hour of processing.",
      },
    ],
    keywords: ["remove background portrait", "portrait background remover", "remove background from selfie"],
  },
  {
    slug: "remove-background-for-shopify-product",
    title: "Remove Background for Shopify Product Photos | Quick Fix",
    h1: "Background remover for Shopify product photos",
    subhead: "One-click cut-outs at 2048×2048, Shopify's recommended size.",
    intro:
      "Clean product shots convert better. Quick Fix strips backgrounds fast, lets you switch to a white or gradient background for a catalog look, and exports directly at Shopify's recommended product size.",
    bullets: [
      "Shopify-ready 2048×2048 export preset",
      "Solid white background or keep transparent PNG",
      "Batch coming soon for Pro (up to 20 images at once)",
      "Perfectly sharp edges on packaged goods, bottles, electronics",
    ],
    howTo: [
      "Upload or paste a product image URL.",
      "Optionally enable auto-crop to tighten the bounding box.",
      "Choose a white background from the preset swatches.",
      "Select the Shopify 2048×2048 download size.",
      "Click download.",
    ],
    faqs: [
      {
        q: "Will the edges be crisp enough for e-commerce?",
        a: "Yes. For hard-edged products, leave Edge softness at 0 for razor-sharp cutouts with no halo.",
      },
      {
        q: "Can I automate this?",
        a: "A public API is available on the Business tier — drop us a line on the pricing page.",
      },
    ],
    keywords: ["shopify background remover", "product photo background", "ecommerce bg removal"],
  },
  {
    slug: "remove-background-from-pet-photo",
    title: "Remove Background From a Pet Photo | Quick Fix",
    h1: "Pet photo background remover — keeps the fur",
    subhead: "Every whisker, every fluff, intact.",
    intro:
      "Fur is the nemesis of most background removers. Quick Fix uses an alpha-matting model that was trained to handle fine, overlapping strands — so your cat's whiskers and your dog's coat don't get flattened.",
    bullets: [
      "Specialised hair mode for pet photos",
      "Handles long, curly, or overlapping fur",
      "Download on any background colour or transparent PNG",
      "Works on cats, dogs, horses, rabbits — anything fluffy",
    ],
    howTo: [
      "Upload a photo of your pet.",
      "Turn on \"Fine hair & edges\".",
      "Wait ~60 seconds.",
      "Choose transparent or a colourful background.",
      "Download.",
    ],
    faqs: [
      {
        q: "My pet has really curly fur — will it still work?",
        a: "Yes. BiRefNet-matting was trained on complex fur samples. It won't be perfect on every strand, but it's the best open-source option currently available.",
      },
    ],
    keywords: ["pet background remover", "dog photo transparent", "cat background removal"],
  },
  {
    slug: "remove-background-from-logo",
    title: "Remove Background From a Logo | Quick Fix",
    h1: "Remove the background from a logo",
    subhead: "Clean transparent PNG in seconds, no Photoshop.",
    intro:
      "If your logo came from a screenshot or a scan, there's often a white or off-white background clinging to it. Quick Fix gives you a clean transparent PNG with crisp edges, ready to drop on any colour.",
    bullets: [
      "Crisp edges on hard-edged graphics",
      "Transparent PNG output, ready for web or print",
      "Works on PNG, JPG, WebP",
      "Export at any custom resolution",
    ],
    howTo: [
      "Drop your logo file.",
      "Keep Edge softness at 0 for razor-sharp vector-style edges.",
      "Check the transparent option.",
      "Pick a custom export size if you need specific dimensions.",
      "Download.",
    ],
    faqs: [
      {
        q: "Will it work on a JPEG logo?",
        a: "Yes, as long as the edges are reasonably clean. The output will always be a PNG with proper transparency.",
      },
    ],
    keywords: ["logo background remover", "transparent logo", "remove white background logo"],
  },
  {
    slug: "transparent-png-maker",
    title: "Free Transparent PNG Maker | Quick Fix",
    h1: "Turn any photo into a transparent PNG",
    subhead: "Drop an image, get a clean PNG with a transparent background.",
    intro:
      "Quick Fix makes transparent PNGs out of any photo — person, product, pet, logo — using state-of-the-art open-source AI. Free for 20 images a month, no sign-up.",
    bullets: [
      "Drop, paste, or URL-upload any JPG/PNG/WebP",
      "AI removes the background automatically",
      "Download a PNG with proper alpha transparency",
      "No watermark, no sign-up, no ads",
    ],
    howTo: [
      "Choose an image.",
      "Wait for processing (~30 seconds).",
      "Confirm it looks good with the before/after slider.",
      "Download the PNG.",
    ],
    faqs: [
      {
        q: "Is it really free?",
        a: "The first 20 images per month are free, anonymous, no sign-up. Upgrade to Pro for 500/month and better-quality processing.",
      },
    ],
    keywords: ["transparent png maker", "transparent background maker", "png transparency tool"],
  },
  {
    slug: "remove-background-from-car-photo",
    title: "Remove Background From a Car Photo | Quick Fix",
    h1: "Car photo background remover",
    subhead: "Perfect for marketplace listings and dealership websites.",
    intro:
      "Quick Fix produces clean, sharp cutouts of cars on any background — useful for marketplace listings, dealer websites, or brochure graphics. Handles reflective paint, chrome, and complex backgrounds.",
    bullets: [
      "Sharp edges on body panels, tyres, and chrome",
      "Replace with any background colour",
      "Download at any resolution",
      "Works for motorcycles, trucks, boats too",
    ],
    howTo: [
      "Upload the photo of the car.",
      "Keep auto-crop off if you want the full frame.",
      "Pick a studio grey background for a showroom look.",
      "Download at 2048×2048 or custom size.",
    ],
    faqs: [
      {
        q: "Will reflections on the paint confuse it?",
        a: "The AI handles most reflections fine. If you see issues with specific highlights, try bumping Edge softness to 0.5.",
      },
    ],
    keywords: ["car background remover", "vehicle photo transparent", "dealer photo background"],
  },
  {
    slug: "remove-background-from-food-photo",
    title: "Remove Background From Food Photos | Quick Fix",
    h1: "Food photo background remover",
    subhead: "Great for menus, delivery apps, and Instagram.",
    intro:
      "Menu cards, delivery apps, and social posts all look more professional with clean isolated food shots. Quick Fix handles plates, bowls, drinks, and packaged goods with crisp edges.",
    bullets: [
      "Handles glossy surfaces, condensation, steam",
      "White background for menu cards, transparent for overlays",
      "Square Instagram export preset built in",
    ],
    howTo: [
      "Upload the photo.",
      "Try auto-crop for a tight plated look.",
      "Export in Instagram 1080×1080 or Shopify 2048×2048.",
    ],
    faqs: [
      {
        q: "Steam and condensation — will those survive?",
        a: "Semi-transparent elements like steam work best with the \"Fine hair & edges\" mode turned on.",
      },
    ],
    keywords: ["food background remover", "menu photo transparent", "delivery app photos"],
  },
  {
    slug: "remove-bg-for-linkedin-profile",
    title: "Background Remover for LinkedIn Profile Photos | Quick Fix",
    h1: "Make a clean LinkedIn profile photo",
    subhead: "Replace your busy background with a studio colour in seconds.",
    intro:
      "A messy background pulls attention away from your face. Quick Fix replaces it with a clean studio grey, slate, or brand colour — and keeps every strand of hair.",
    bullets: [
      "LinkedIn-ready 400×400 or 1200×627 header exports",
      "Studio background presets: white, slate, brand purple",
      "Fine-hair mode for tidy edges",
    ],
    howTo: [
      "Upload your current profile photo.",
      "Turn on \"Fine hair & edges\".",
      "Pick a Slate or Studio preset background.",
      "Download at 400×400.",
    ],
    faqs: [
      {
        q: "Will it make me look edited?",
        a: "The edges are soft enough to look natural. If you want a hard cut-out (for a creative effect), turn Edge softness down to 0.",
      },
    ],
    keywords: ["linkedin profile background", "professional headshot background", "clean profile photo"],
  },
  {
    slug: "remove-bg-for-ebay-listing",
    title: "Background Remover for eBay Listings | Quick Fix",
    h1: "Background remover for eBay & marketplace photos",
    subhead: "Instant white-background product photos, the way marketplaces like.",
    intro:
      "Most marketplaces prefer photos with clean white backgrounds. Quick Fix removes the background and drops your product onto pure white — no studio needed.",
    bullets: [
      "Pure-white e-commerce background preset",
      "Batch-ready (Pro tier)",
      "Export at 2000×2000 (Amazon) or custom",
    ],
    howTo: [
      "Upload your product photo.",
      "Turn on auto-crop to tighten the frame.",
      "Pick the white preset.",
      "Export at 2000×2000.",
    ],
    faqs: [
      {
        q: "Amazon has specific rules — will this meet them?",
        a: "The 2000×2000 pure-white export is compatible with Amazon's main image requirements. Always double-check their latest policy.",
      },
    ],
    keywords: ["ebay background remover", "amazon product photo", "marketplace listing photos"],
  },
  {
    slug: "background-remover-for-etsy",
    title: "Background Remover for Etsy Listings | Quick Fix",
    h1: "Background remover built for Etsy sellers",
    subhead: "Make handmade product photos look studio-grade.",
    intro:
      "Etsy listings with clean, consistent backgrounds convert better. Quick Fix strips whatever's behind your handmade item and drops it on a branded colour of your choice.",
    bullets: [
      "Handles woven, textured, and wood-surface backgrounds",
      "Soft feather preserves yarn, lace, and fabric textures",
      "Export to Etsy's recommended 2000×2000 square",
    ],
    howTo: [
      "Upload your Etsy product photo.",
      "Turn on \"Fine hair & edges\" if it's textile.",
      "Pick a custom brand colour.",
      "Export at 2000×2000.",
    ],
    faqs: [
      {
        q: "Will knitted or crocheted items keep their texture?",
        a: "Yes — the matting model is specifically good at yarn-like fine detail. Use the Fine hair mode and bump Edge softness to ~1.2 for best results.",
      },
    ],
    keywords: ["etsy background remover", "handmade product photo", "textile background removal"],
  },
  {
    slug: "remove-bg-from-screenshot",
    title: "Remove Background From a Screenshot | Quick Fix",
    h1: "Background remover for screenshots",
    subhead: "Paste a screenshot, get a transparent cutout instantly.",
    intro:
      "Screenshots often need the background removed for presentations, docs, or social posts. Quick Fix works great with macOS, Windows, and browser screenshots.",
    bullets: [
      "Paste straight from your clipboard (⌘V)",
      "Fast processing of UI elements, charts, and diagrams",
      "Export as transparent PNG for slides or docs",
    ],
    howTo: [
      "Take a screenshot (⌘+Shift+4 on macOS).",
      "Visit Quick Fix and press ⌘V to paste.",
      "Wait 30 seconds.",
      "Download the transparent PNG.",
    ],
    faqs: [],
    keywords: ["screenshot background remove", "transparent screenshot", "paste image bg remove"],
  },
  // ===========================================================================
  // UPSCALE use-cases
  // ===========================================================================
  {
    slug: "upscale-old-photos",
    tool: "upscale",
    title: "Upscale Old Photos 2× or 4× | Quick Fix",
    h1: "Bring old, low-resolution photos back to life",
    subhead: "2×/4× AI upscaling with Swin2SR — open source, no sign-up.",
    intro:
      "Old photos scanned at low DPI, pre-2010 digital camera shots, and re-compressed social-media downloads can all be sharpened and enlarged. Quick Fix uses the Swin2SR model to hallucinate convincing detail instead of just interpolating pixels.",
    bullets: [
      "Restores sharpness in faces, fabric, text",
      "2× lightweight mode is fast (~60s on CPU)",
      "4× BSRGAN-trained mode is best for faded photos",
      "Your image is deleted within an hour",
    ],
    howTo: [
      "Drop or paste the old photo.",
      "Pick 2× for a quick bump, or 4× for maximum detail.",
      "Wait for the upscale to finish.",
      "Download as PNG, JPG, or WebP.",
    ],
    faqs: [
      {
        q: "Will it make a blurry photo sharp?",
        a: "Swin2SR handles moderate blur well. Extreme motion blur or heavy defocus isn't magic — but most faded or low-res scans come out noticeably better.",
      },
      {
        q: "Can I upscale colour photos from the 90s?",
        a: "Yes. 4× mode is specifically trained on real-world degraded images, which matches that era's photos well.",
      },
    ],
    keywords: ["upscale old photos", "enhance old photos", "restore scanned photos"],
  },
  {
    slug: "upscale-image-for-print",
    tool: "upscale",
    title: "Upscale Images for Print | Quick Fix",
    h1: "Upscale photos to print-ready resolution",
    subhead: "Turn a 72 DPI screenshot into a 300 DPI print file.",
    intro:
      "Printers need roughly 300 DPI at the physical print size, which often means upscaling your source photo 2-4×. Quick Fix does it without the pixelated or plastic look of traditional upscalers.",
    bullets: [
      "2× and 4× factors cover most print use cases",
      "Output is PNG by default — drop into Illustrator or InDesign",
      "Natural-looking detail instead of sharpening artifacts",
    ],
    howTo: [
      "Calculate the target size: print width in inches × 300 = pixels needed.",
      "Upload your source image.",
      "Pick 2× or 4× depending on how much you need to enlarge.",
      "Download and drop into your layout.",
    ],
    faqs: [
      {
        q: "What DPI will the output be?",
        a: "DPI is metadata — the actual pixel count is what matters. Quick Fix gives you 2× or 4× the pixel dimensions. Your layout software can then assign whatever DPI suits the physical size.",
      },
    ],
    keywords: ["upscale for print", "300 dpi upscaler", "print-ready image enlarge"],
  },
  {
    slug: "enhance-low-resolution-images",
    tool: "upscale",
    title: "Enhance Low-Resolution Images | Quick Fix",
    h1: "Enhance any low-resolution image with AI",
    subhead: "Swin2SR turns a thumbnail into a usable image.",
    intro:
      "If someone sent you a tiny image attachment or you're working from a low-res social media download, Quick Fix can 2× or 4× it up to a usable resolution with believable detail.",
    bullets: [
      "Works on photos, product shots, graphics",
      "No sign-up for first 20 images a month",
      "Output up to ~3000×3000 pixels",
    ],
    howTo: [
      "Upload or paste-in the tiny image.",
      "Start with 2× for speed, switch to 4× if you need more.",
      "Review the before/after slider to judge quality.",
      "Download in PNG, JPG, or WebP.",
    ],
    faqs: [],
    keywords: ["enhance low resolution image", "increase image resolution", "ai image enhancer"],
  },
  {
    slug: "upscale-social-media-avatar",
    tool: "upscale",
    title: "Upscale Social Media Avatar | Quick Fix",
    h1: "Upscale small profile pictures to HD",
    subhead: "Your 200×200 avatar → a sharp 800×800 HD headshot.",
    intro:
      "Profile pictures get compressed and downsized by social platforms. If all you have is a small original, Quick Fix can 4× it up to a resolution that actually reads well on modern displays.",
    bullets: [
      "4× mode handles small portrait inputs especially well",
      "Output at 800×800 or 1600×1600 after upscale",
      "Privacy-friendly — deleted after 1 hour",
    ],
    howTo: [
      "Drop your profile picture.",
      "Pick 4× for maximum detail.",
      "Wait a few minutes (CPU inference).",
      "Download and re-upload wherever you need.",
    ],
    faqs: [],
    keywords: ["profile picture upscaler", "avatar enhancer", "hd profile picture"],
  },
  {
    slug: "upscale-product-photos",
    tool: "upscale",
    title: "Upscale Product Photos | Quick Fix",
    h1: "Upscale product photos for e-commerce listings",
    subhead: "Meet Shopify's 2048×2048 recommendation even with small originals.",
    intro:
      "Shopify, Etsy, and Amazon all reward high-resolution product photos with sharper zoom and better placement. Quick Fix upscales smaller shots so they match marketplace ideals without needing a reshoot.",
    bullets: [
      "Hits Shopify's 2048×2048 and Amazon's 2000×2000 targets",
      "Works well for clean, well-lit product shots",
      "Pair with the background remover for full studio look",
    ],
    howTo: [
      "Upload the product photo.",
      "Pick 2× or 4× based on the source size.",
      "Download as PNG or as a JPG at 90%.",
      "Optionally bounce over to the background remover to put it on pure white.",
    ],
    faqs: [
      {
        q: "Should I remove the background first or upscale first?",
        a: "Upscale first. Background removal is sharper and more reliable on a higher-resolution input.",
      },
    ],
    keywords: ["upscale product photo", "ecommerce photo upscaler", "shopify photo resolution"],
  },
  // ===========================================================================
  // ALTERNATIVES / COMPARISONS
  // ===========================================================================
  {
    slug: "alternative-to-removebg",
    title: "Free Remove.bg Alternative | Quick Fix",
    h1: "A free, open-source alternative to Remove.bg",
    subhead: "Same quality, no sign-up for the first 20 images, and a credit pack for cheaper overage.",
    intro:
      "Remove.bg is good but expensive once you hit paid tiers. Quick Fix runs the same class of SOTA model (BiRefNet + matting refinement), charges less, and has no sign-up for the free tier.",
    bullets: [
      "20 free images per month, anonymous",
      "Pro at $9/mo for 500 images — cheaper than Remove.bg",
      "Credit packs: $5 for 100, $40 for 1000",
      "No watermark on free-tier outputs",
    ],
    howTo: [
      "Drop or paste your image.",
      "Done. No sign-up needed for the first 20.",
    ],
    faqs: [
      {
        q: "How does quality compare?",
        a: "Quick Fix uses BiRefNet-matting, the same open-source model that beats BiRefNet base on hair detail. Quality is competitive with Remove.bg on most inputs.",
      },
    ],
    keywords: ["removebg alternative", "free remove.bg", "cheap background remover"],
  },
];
