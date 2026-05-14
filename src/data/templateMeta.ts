export type TemplateMeta = {
  brandName: string;
  category: string;
  description: string;
};

export const templateMeta: Record<string, TemplateMeta> = {
  restaurant: {
    brandName: "Spice Trail",
    category: "FOOD",
    description: "Modern restaurant website with photo-led menu, online ordering, table reservations and a live delivery tracker — built for India's QSR boom.",
  },
  salon: {
    brandName: "Velvet Studio",
    category: "BEAUTY",
    description: "Elegant unisex salon site with service menu, stylist profiles, before-after gallery and one-tap appointment booking for walk-ins or bridal.",
  },
  gym: {
    brandName: "PulseFit",
    category: "FITNESS",
    description: "High-energy gym site with membership tiers, class timetable, trainer wall and a free-trial CTA that captures leads in seconds.",
  },
  "coaching-centre": {
    brandName: "BrightMinds Academy",
    category: "EDUCATION",
    description: "Coaching institute & tuition centre site with royal blue & orange palette, toppers wall, batch schedule, fee structure and scholarship test enrolment.",
  },
  clinic: {
    brandName: "WellCare Clinic",
    category: "HEALTH",
    description: "Multi-specialty clinic site with doctor profiles, OPD timings, online appointment booking, insurance list and a one-tap telemedicine flow.",
  },
  dentist: {
    brandName: "SmileBright Dental",
    category: "HEALTH",
    description: "Bright, trust-building dental clinic site with treatment list, smile gallery, transparent pricing, no-cost EMI and free first-consultation CTA.",
  },
  hotel: {
    brandName: "Vista Suites",
    category: "HOSPITALITY",
    description: "Premium hotel website with room gallery, calendar-based booking, amenity icons, guest reviews and seasonal-deal banner.",
  },
  bakery: {
    brandName: "Crust & Crumb",
    category: "FOOD",
    description: "Warm artisan bakery site with custom cake builder, festive collections, midnight delivery and a gift hamper customiser.",
  },
  boutique: {
    brandName: "Aura",
    category: "STORE",
    description: "Modern clean universal marketplace with off-white canvas, warm-gold accents, editorial typography and product-led storytelling.",
  },
  "furniture-shop": {
    brandName: "Nest",
    category: "STORE",
    description: "Room-wise furniture catalogue with AR visualiser, 3-year warranty badge, EMI option and inspiration galleries.",
  },
  "kirana-store": {
    brandName: "DailyBasket",
    category: "GROCERY",
    description: "Hyperlocal grocery site with pincode check, 10-minute delivery promise, smart basket suggestions and seamless UPI checkout.",
  },
  tailor: {
    brandName: "Stitch Atelier",
    category: "SERVICE",
    description: "Bespoke tailoring website with fabric swatches, online measurement guide, portfolio gallery and WhatsApp enquiry.",
  },
  "medical-store": {
    brandName: "MediQuick",
    category: "HEALTH",
    description: "E-pharmacy site with prescription upload, generic alternative suggestions, auto-refill subscription and lab test booking.",
  },
  "mobile-repair": {
    brandName: "FixHub",
    category: "SERVICE",
    description: "Phone repair site with instant quote calculator by brand & issue, doorstep pickup, genuine parts warranty and live status tracker.",
  },
  mechanic: {
    brandName: "GearWorks",
    category: "AUTOMOTIVE",
    description: "Multi-brand car service site with package comparison, doorstep pickup, transparent inspection reports and AMC plans.",
  },
  "sweet-shop": {
    brandName: "Mithai Mahal",
    category: "FOOD",
    description: "Heritage mithai brand site with weight selector, festival collections, Diwali mega-box configurator and pan-India shipping.",
  },
  laundry: {
    brandName: "FreshFold",
    category: "SERVICE",
    description: "Tech-led laundry site with per-garment pricing, slot-based pickup, monthly subscription plans and RFID order tracking.",
  },
  "stationery-shop": {
    brandName: "InkWell",
    category: "STORE",
    description: "Stationery & art supplies store with brand filters, school-kit builder by grade, bulk pricing and craft-workshop bookings.",
  },
  "electrical-shop": {
    brandName: "VoltMart",
    category: "STORE",
    description: "Modern electrical retail site with product specs, brand filters, contractor pricing, energy-savings calculator and dealer locator.",
  },
  "hardware-store": {
    brandName: "ToolBox",
    category: "STORE",
    description: "Hardware & tools site with paints, plumbing and DIY tips. Project quantity calculator and contractor-grade pricing built in.",
  },
  photographer: {
    brandName: "ClickCraft Studios",
    category: "CREATIVE",
    description: "Award-winning photography studio in Bangalore specialising in weddings, portraits, products and events. Every frame is a masterpiece.",
  },
  caterer: {
    brandName: "Feast Foundry",
    category: "FOOD",
    description: "Wedding & corporate catering site with per-plate calculator, live counter showcase, dietary filters and past-event gallery.",
  },
  plumber: {
    brandName: "PipeFix",
    category: "SERVICE",
    description: "Local plumber site with transparent rate card, same-day emergency booking, live professional tracking and 30-day work warranty.",
  },
  "jewellery-shop": {
    brandName: "Auralis",
    category: "STORE",
    description: "Luxury gold & diamond jewellery site with live gold rate ticker, AR try-on, bridal editorial section and BIS hallmark guarantee.",
  },
  optician: {
    brandName: "Eye Studio",
    category: "STORE",
    description: "Eyewear shop with virtual 3D try-on, face-shape recommendations, prescription upload and free home-trial of 5 frames.",
  },
  "pet-shop": {
    brandName: "PawNest",
    category: "STORE",
    description: "Pet care platform with pet-type selector, breed-specific recommendations, vet video consult and auto-refill subscriptions.",
  },
  "printing-press": {
    brandName: "PrintCraft",
    category: "SERVICE",
    description: "Online printing site with drag-drop design tool, 1000+ templates, bulk pricing and same-day pickup.",
  },
  "car-wash": {
    brandName: "ShineWash",
    category: "AUTOMOTIVE",
    description: "Car wash & detailing site with package comparison, ceramic-coating specialist showcase, doorstep service and monthly unlimited plan.",
  },
  "driving-school": {
    brandName: "Wheels Academy",
    category: "EDUCATION",
    description: "Driving school site with car & 2-wheeler courses, batch calendar, RTO process guide, simulator demo and pass-rate statistics.",
  },
  "nursery-plant-shop": {
    brandName: "GreenHaven",
    category: "STORE",
    description: "Indoor & outdoor plants nursery with care guides, light/water icons, plant doctor chat support and kitchen-garden kits.",
  },
  "paint-shop": {
    brandName: "ColorCove",
    category: "STORE",
    description: "Paint brand site with AR room visualiser, painting service marketplace, quantity calculator and inspiration gallery.",
  },
  "tiles-shop": {
    brandName: "TileWorks",
    category: "STORE",
    description: "Tiles & marble showroom site with size/finish filters, room visualiser, sample ordering and project bulk pricing.",
  },
  "sanitary-shop": {
    brandName: "BathLuxe",
    category: "STORE",
    description: "Premium bath & sanitaryware site with 3D bathroom designer, smart-toilet configurator, water-savings calculator and installation service.",
  },
  "glass-shop": {
    brandName: "ClearView",
    category: "STORE",
    description: "Glass solutions site with architectural, automotive and interior specs, project gallery and energy-savings calculator.",
  },
  "tent-house": {
    brandName: "Royal Tents",
    category: "EVENTS",
    description: "Wedding decor & tent house site with theme selector, 3D venue preview, package comparison and past-event photo gallery.",
  },
  florist: {
    brandName: "Bloom & Bloom",
    category: "STORE",
    description: "Online florist with occasion categories, same-day & midnight delivery, add-on cake/chocolate combos and corporate gifting.",
  },
  "cobbler-shop": {
    brandName: "Sole Revive",
    category: "SERVICE",
    description: "Premium shoe repair site with sneaker specialist services, pickup & delivery, before-after gallery and care-tip blog.",
  },
  "watch-repair": {
    brandName: "TimeHaus",
    category: "SERVICE",
    description: "Luxury watch service site with Swiss-trained technicians, brand certification badges, humidity-controlled storage and status tracker.",
  },
  "ac-repair": {
    brandName: "CoolFix",
    category: "SERVICE",
    description: "AC service site with AC-type selector, same-day emergency, AMC plans, live technician tracking and seasonal offer banner.",
  },
  "refrigerator-repair": {
    brandName: "FrostFix",
    category: "SERVICE",
    description: "Multi-brand refrigerator repair site with issue diagnostic quiz, transparent pricing and warranty-backed service.",
  },
  "cctv-installation": {
    brandName: "SecureView",
    category: "SERVICE",
    description: "CCTV brand site with camera-type categories, package comparison, AI face-detection showcase and storage calculator.",
  },
  "interior-designer": {
    brandName: "Space Studio",
    category: "CREATIVE",
    description: "Modular kitchen, wardrobe and full-home interior site with style quiz, 3D walkthrough, EMI plans and 45-day delivery guarantee.",
  },
  architect: {
    brandName: "Form Studio",
    category: "CREATIVE",
    description: "Award-winning architecture practice site with project portfolio, design philosophy, awards showcase and team spotlight.",
  },
  "event-planner": {
    brandName: "Vivah Events",
    category: "EVENTS",
    description: "Full-stack event planning site with package pricing, vendor marketplace, past-event gallery and budget tracker.",
  },
  "travel-agent": {
    brandName: "Wanderly",
    category: "TRAVEL",
    description: "Modern travel agency site with flight/hotel search, holiday packages, visa assistance and loyalty wallet.",
  },
  "courier-service": {
    brandName: "ZipShip",
    category: "LOGISTICS",
    description: "Logistics site with shipment tracking, instant rate calculator, pincode check, pickup scheduling and bulk accounts.",
  },
  "cyber-cafe": {
    brandName: "DigiPoint",
    category: "SERVICE",
    description: "Digital service centre site with internet, printing, Aadhaar/PAN/passport services, online form filling and student discount.",
  },
  "xerox-shop": {
    brandName: "PrintPoint",
    category: "SERVICE",
    description: "Copy & print shop site with file upload, bulk pricing, binding/lamination options, store locator and corporate accounts.",
  },
  "beauty-parlour": {
    brandName: "GlowUp Parlour",
    category: "BEAUTY",
    description: "Premium beauty parlour site with hair, skin, nails and bridal makeup services. Before-after gallery and loyalty program.",
  },
  "barber-shop": {
    brandName: "Sharp & Co",
    category: "BEAUTY",
    description: "Modern men's grooming barbershop site with service price list, barber profiles, walk-in/appointment booking and grooming products shop.",
  },
};
