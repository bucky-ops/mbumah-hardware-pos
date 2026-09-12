#!/usr/bin/env python3
"""Canonical categories + product templates + Kenyan name pools for population."""

STORES = [
    {"id": "store_juja_main",    "code": "JMA", "city": "Juja",    "location": "Salama M-Store, Juja"},
    {"id": "store_nairobi_cbd",  "code": "NCB", "city": "Nairobi", "location": "Kenyatta Avenue, Nairobi"},
    {"id": "store_nakuru",       "code": "NAK", "city": "Nakuru",  "location": "Nakuru Town, Nakuru County"},
    {"id": "store_ruiru",        "code": "RUI", "city": "Ruiru",   "location": "Ruiru Town, Kiambu County"},
    {"id": "store_thika",        "code": "THK", "city": "Thika",   "location": "Thika Town, Kiambu County"},
]

CATEGORIES = [
    ("Power Tools",          "🔧", "#E67E22", "Drills, grinders, saws and other powered equipment"),
    ("Hand Tools",           "🔨", "#8E44AD", "Hammers, spanners, pliers and manual tools"),
    ("Building Materials",   "🧱", "#795548", "Cement, steel, aggregates, boards and waterproofing"),
    ("Electrical Supplies",  "💡", "#F1C40F", "Cables, switches, lighting, breakers and solar"),
    ("Plumbing Supplies",    "🚰", "#16A085", "Pipes, fittings, taps, sanitary ware and tanks"),
    ("Paint & Finishes",     "🎨", "#C0392B", "Emulsions, enamels, primers, brushes and fillers"),
    ("Hardware & Fasteners", "🔩", "#2C3E50", "Nails, screws, hinges, locks and door hardware"),
    ("Garden & Outdoor",     "🌱", "#27AE60", "Wheelbarrows, spades, hoses and outdoor equipment"),
    ("Safety & Workwear",    "🦺", "#D35400", "Helmets, boots, gloves, harnesses and PPE"),
    ("Home Appliances",      "🏠", "#2980B9", "Cookers, TVs, freezers, fans and small appliances"),
]

CAT_KEYS = [c[0] for c in CATEGORIES]

# (name, category, unitType, price_kes, spec, isRental)
PRODUCTS = [
    # Power Tools
    ("Bosch GBH 2-26 Rotary Hammer Drill", "Power Tools", "PIECE", 18500, "800W, SDS-plus, 26mm, 2.7J impact energy", False),
    ("Makita HR2470 Rotary Hammer", "Power Tools", "PIECE", 21000, "780W, SDS-plus, 24mm, 3-mode", False),
    ("DeWalt DWE305 Angle Grinder 4.5in", "Power Tools", "PIECE", 7800, "1100W, 11000rpm, slim grip", False),
    ("Bosch GWS 900 Angle Grinder", "Power Tools", "PIECE", 6200, "900W, 4.5in disc, 11000rpm", False),
    ("Makita M5801 Circular Saw 7.25in", "Power Tools", "PIECE", 12500, "1010W, 5200rpm, bevel 0-45deg", False),
    ("Black+Decker KR554RE Impact Drill 13mm", "Power Tools", "PIECE", 5400, "550W, variable speed, reverse", False),
    ("Stanley SCH20 Hammer Drill 620W", "Power Tools", "PIECE", 4900, "620W, 13mm chuck, hammer mode", False),
    ("Ingco Cordless Drill 20V with 2 Batteries", "Power Tools", "PIECE", 6800, "20V Li-ion, 13mm, 2-speed, 2x2.0Ah", False),
    ("Total Cordless Impact Wrench 21V", "Power Tools", "PIECE", 9200, "21V, 350Nm, 1/2in square drive", False),
    ("Ingco Jig Saw 650W", "Power Tools", "PIECE", 5600, "650W, 0-3000spm, 65mm wood cut", False),
    # Hand Tools
    ("Stanley 16oz Claw Hammer Steel Shaft", "Hand Tools", "PIECE", 950, "Forged steel head, shock-absorbing grip", False),
    ("Bossman 12in Adjustable Wrench", "Hand Tools", "PIECE", 620, "Chrome vanadium, 0-34mm jaw", False),
    ("Insulated Screwdriver Set 6pc 1000V", "Hand Tools", "PIECE", 1150, "VDE 1000V, SL/PH/PZ tips, rack", False),
    ("Stanley 5m Tape Measure", "Hand Tools", "PIECE", 780, "25mm blade, lock, belt clip", False),
    ("Pliers Set 3pc Combination Long-Nose Diagonal", "Hand Tools", "SET", 1450, "Drop-forged, 7-8in, dipped grips", False),
    ("Bosch 12pc HSS Drill Bit Set", "Hand Tools", "SET", 1690, "HSS-G, 1.5-10mm, metal case", False),
    ("Spirit Level 600mm Aluminium", "Hand Tools", "PIECE", 1850, "3 vials, milled face, 0.5mm/m", False),
    ("Adjustable Spanner Set 3pc 6/8/10in", "Hand Tools", "SET", 2150, "Chrome vanadium, precision worm", False),
    ("Retractable Utility Knife", "Hand Tools", "PIECE", 350, "Die-cast body, 10 spare blades", False),
    ("Putty Knife 50mm Stainless Steel", "Hand Tools", "PIECE", 280, "Flexible blade, comfort handle", False),
    # Building Materials
    ("Bamburi Nguvu Cement 32.5N 50kg", "Building Materials", "BAG", 780, "CEM II 32.5N, KEBS certified", False),
    ("Savannah Cement 32.5R 50kg", "Building Materials", "BAG", 765, "CEM II 32.5R, fast setting", False),
    ("Y12 Deformed Steel Bar 12m", "Building Materials", "PIECE", 1420, "High-yield ribbed rebar, B500B", False),
    ("D8 Smooth Round Bar 12m", "Building Materials", "PIECE", 640, "Mild steel stirrup/link bar", False),
    ("Gauge 30 IT4 Galvanized Roofing Sheet", "Building Materials", "PIECE", 890, "IT4 profile, Z275 coating, 6ft", False),
    ("Machine Cut Stone 6x9in", "Building Materials", "PIECE", 95, "Precut building block, straight edges", False),
    ("River Sand 50kg Bag", "Building Materials", "BAG", 180, "Washed plaster sand, screened", False),
    ("Ballast 3/4in 50kg Bag", "Building Materials", "BAG", 260, "Crushed aggregate 19mm, concrete work", False),
    ("Bituminous Membrane 4mm 10sqm Roll", "Building Materials", "SET", 3900, "APP torch-on waterproofing, polyester reinforced", False),
    ("Gypsum Ceiling Board 9mm 2400x1200", "Building Materials", "PIECE", 1250, "Tapered edge, ivory paper face", False),
    # Electrical Supplies
    ("Twin & Earth Cable 2.5sqmm 100m Roll", "Electrical Supplies", "SET", 8900, "6242Y, 634A, KEBS approved", False),
    ("Flexible Cable 1.5sqmm 100m Roll", "Electrical Supplies", "SET", 6400, "3183Y, 3-core, 300/500V", False),
    ("13A Double Switched Socket (Schneider)", "Electrical Supplies", "PIECE", 550, "UK 3-pin, neon indicator, white", False),
    ("1-Gang 2-Way Light Switch", "Electrical Supplies", "PIECE", 260, "10AX 250V, white moulded", False),
    ("LED Bulb 9W E27 Warm White", "Electrical Supplies", "PIECE", 180, "806lm, 6500K options, 15k hrs", False),
    ("LED Flood Light 100W IP66", "Electrical Supplies", "PIECE", 2450, "9000lm, 6500K, 2yr warranty", False),
    ("Consumer Unit 8-Way with Main Switch", "Electrical Supplies", "PIECE", 3850, "100A main, DIN rail, metal clad", False),
    ("Circuit Breaker MCB 32A Type C", "Electrical Supplies", "PIECE", 480, "6kA breaking, single pole", False),
    ("Solar Panel 150W 12V Monocrystalline", "Electrical Supplies", "PIECE", 11500, "21% cell efficiency, 25yr output", False),
    ("Deep Cycle Battery 100Ah 12V", "Electrical Supplies", "PIECE", 19800, "AGM sealed, solar/backup use", False),
    # Plumbing Supplies
    ("PPR Pipe 20mm PN20 4m Length", "Plumbing Supplies", "PIECE", 420, "Hot/cold water, PN20, DIN 8077", False),
    ("PVC Waste Pipe 4in x 6m", "Plumbing Supplies", "PIECE", 1380, "BS 4514 soil/waste, socket one end", False),
    ("PVC Elbow 4in 87.5deg", "Plumbing Supplies", "PIECE", 210, "Solvent weld, soil system", False),
    ("Kitchen Mixer Tap Chrome", "Plumbing Supplies", "PIECE", 3650, "Swivel spout, brass body, ceramic cartridge", False),
    ("Bathroom Shower Mixer Set Chrome", "Plumbing Supplies", "SET", 4850, "Mixer + riser rail + handset", False),
    ("Close-Coupled WC Toilet Suite", "Plumbing Supplies", "SET", 14900, "Pan + cistern + seat, dual flush 3/6L", False),
    ("Kitchen Sink Double Bowl Stainless", "Plumbing Supplies", "PIECE", 8900, "304 stainless, 1160x460mm, basket strainers", False),
    ("Water Tank 1000L Rotomoulded", "Plumbing Supplies", "PIECE", 12400, "UV stabilised PE, 8-layer, 5yr warranty", False),
    ("PPR Ball Valve 20mm", "Plumbing Supplies", "PIECE", 290, "PPR-PR fused ends, brass ball", False),
    ("Teflon Thread Seal Tape Roll", "Plumbing Supplies", "PIECE", 60, "PTFE 12m x 12mm, 0.075mm", False),
    # Paint & Finishes
    ("Crown Silk Vinyl Emulsion 20L White", "Paint & Finishes", "SET", 6800, "Silk sheen interior, 12sqm/L", False),
    ("Crown Weatherguard Exterior 20L", "Paint & Finishes", "SET", 8900, "10yr weather protection, acrylic", False),
    ("Gloss Enamel 4L Brilliant White", "Paint & Finishes", "SET", 2450, "High gloss, wood/metal, quick dry", False),
    ("Red Oxide Undercoat 4L", "Paint & Finishes", "SET", 1850, "Anti-rust base coat for metal", False),
    ("Basco Wood Varnish Clear 4L", "Paint & Finishes", "SET", 2750, "Polyurethane, satin finish", False),
    ("Paint Brush 4in Premium Bristle", "Paint & Finishes", "PIECE", 480, "Natural bristle, stainless ferrule", False),
    ("Paint Roller 9in with Tray Set", "Paint & Finishes", "SET", 750, "Mohair sleeve + 230mm tray", False),
    ("Ready Mixed Wall Filler 10kg", "Paint & Finishes", "SET", 1350, "Fine finish interior filler", False),
    ("PVA Sealer Primer 20L", "Paint & Finishes", "SET", 4600, "Plaster bonding primer", False),
    ("Turpentine Thinners 4L", "Paint & Finishes", "LITER", 1150, "Brush cleaner & oil-paint thinner", False),
    # Hardware & Fasteners
    ("Wire Nails 4in 1kg", "Hardware & Fasteners", "KILOGRAM", 210, "Bright finish, general carpentry", False),
    ("Roofing Nails Gauge 12 with Washer 1kg", "Hardware & Fasteners", "KILOGRAM", 265, "Twisted shank + bitumen washer", False),
    ("Wood Screws 2in Box of 200", "Hardware & Fasteners", "BOX", 480, "Countersunk, zinc plated, PZ2", False),
    ("Brass Butt Hinges 4in Pair", "Hardware & Fasteners", "PIECE", 320, "3mm gauge, loose pin", False),
    ("Heavy Duty Padlock 50mm", "Hardware & Fasteners", "PIECE", 690, "5-lever, hardened shackle, 3 keys", False),
    ("Chrome Lever Door Handle Set", "Hardware & Fasteners", "SET", 1250, "Rose-fix, latch + strikes included", False),
    ("Tower Bolt 6in Black", "Hardware & Fasteners", "PIECE", 250, "Heavy gauge, surface fix", False),
    ("Steel Door Frame 900mm", "Hardware & Fasteners", "PIECE", 3850, "Pressed steel, primer finish", False),
    ("Binding Wire 25kg Roll", "Hardware & Fasteners", "SET", 4200, "16 gauge annealed, rebar tying", False),
    ("Chicken Mesh 30m x 900mm Roll", "Hardware & Fasteners", "SET", 2850, "Gauge 24, hexagonal, galvanised", False),
    # Garden & Outdoor
    ("Heavy Duty Wheelbarrow 90L", "Garden & Outdoor", "PIECE", 4850, "Galvanised tray, pneumatic wheel", False),
    ("Round Point Shovel", "Garden & Outdoor", "PIECE", 950, "Forged blade, 48in hardwood shaft", False),
    ("Garden Fork 4-Tine", "Garden & Outdoor", "PIECE", 1050, "Carbon steel, ash handle", False),
    ("Slasher 24in with Handle", "Garden & Outdoor", "PIECE", 1350, "Clearing brush, double-edged", False),
    ("Garden Hose 20m 1/2in", "Garden & Outdoor", "SET", 1650, "3-layer PVC + fittings", False),
    ("Hedge Shears Wavy Blade", "Garden & Outdoor", "PIECE", 1850, "254mm blade, shock stops", False),
    ("Pressure Sprayer 16L", "Garden & Outdoor", "PIECE", 3250, "Lance + 3 nozzles, viton seals", False),
    ("Garden Rake 16-Tine", "Garden & Outdoor", "PIECE", 890, "Spring steel tines, hardwood handle", False),
    ("Galvanized Watering Can 10L", "Garden & Outdoor", "PIECE", 780, "Hot-dip galvanised, brass rose", False),
    ("Petrol Lawn Mower 17in", "Garden & Outdoor", "PIECE", 38500, "3.5HP, 4-stroke, grass bag", False),
    # Safety & Workwear
    ("Safety Helmet Yellow ANSI Z89", "Safety & Workwear", "PIECE", 650, "HDPE shell, 4-point suspension", False),
    ("Steel Toe Safety Boots Size 42", "Safety & Workwear", "PIECE", 3450, "S3 rated, oil-resistant sole", False),
    ("Clear Safety Goggles", "Safety & Workwear", "PIECE", 280, "Anti-fog, indirect vents", False),
    ("Leather Work Gloves Pair", "Safety & Workwear", "PIECE", 350, "Chrome leather, palm reinforced", False),
    ("N95 Dust Masks Pack of 5", "Safety & Workwear", "BOX", 400, "95% filtration, valve optional", False),
    ("Hi-Vis Reflective Vest", "Safety & Workwear", "PIECE", 550, "EN ISO 20471 class 2, L/XL", False),
    ("Ear Defenders SNR 27dB", "Safety & Workwear", "PIECE", 1450, "Adjustable headband, ABS cups", False),
    ("Cotton Boilersuit Coverall XL", "Safety & Workwear", "PIECE", 1650, "65/35 poly-cotton, action back", False),
    ("Full Body Safety Harness", "Safety & Workwear", "PIECE", 4850, "EN 361, double lanyard + shock absorber", False),
    ("First Aid Kit 25-Person", "Safety & Workwear", "BOX", 3950, "OSHA compliant, wall-mount case", False),
    # Home Appliances
    ("Vitron 32in LED Digital TV", "Home Appliances", "PIECE", 16900, "HD ready, USB/HDMI, inbuilt decoder", False),
    ("Electric Kettle 1.7L Stainless", "Home Appliances", "PIECE", 1950, "2200W, auto shut-off, boil-dry protection", False),
    ("2-Plate Electric Cooker Hotplates", "Home Appliances", "PIECE", 4850, "Dual 1500/1000W, thermostat", False),
    ("Microwave Oven 20L Digital", "Home Appliances", "PIECE", 9850, "700W, 5 power levels, child lock", False),
    ("Ramtons 42L Chest Freezer", "Home Appliances", "PIECE", 27500, "A+ energy, white, 4-star", False),
    ("Semi-Automatic Washing Machine 7kg", "Home Appliances", "PIECE", 21500, "Twin tub, spin dry, copper motor", False),
    ("Charcoal Flat Iron Boxed", "Home Appliances", "PIECE", 1250, "Cast iron, traditional laundry", False),
    ("Electric Pressure Washer 135bar", "Home Appliances", "PIECE", 14500, "1800W, 6.5L/min, lance + turbo nozzle", True),
    ("Standing Fan 16in 3-Speed", "Home Appliances", "PIECE", 3650, "Oscillating, timer, chrome grill", False),
    ("Water Dispenser Hot & Cold Floor", "Home Appliances", "PIECE", 8950, "Stainless tank, child safety lock", False),
    # Rental fleet (extra templates, flagged isRental)
    ("Kipor IG2600 Inverter Generator 2.6kVA", "Power Tools", "PIECE", 98000, "Petrol inverter, 63dB, 5.7h tank", True),
    ("Conmix 350L Concrete Mixer", "Building Materials", "PIECE", 74500, "Petrol engine, drum 350L, towable", True),
    ("Aluminium Scaffolding Tower 4m", "Building Materials", "SET", 58000, "Working height 6m, 150kg platform", True),
    ("Tile Cutter 600mm Heavy Duty", "Hand Tools", "PIECE", 9800, "Dual rail, tungsten wheel, 14mm cut", True),
    ("Plate Compactor 90kg", "Building Materials", "PIECE", 88000, "5.5HP petrol, 15kN centrifugal", True),
]

# Extra suppliers
SUPPLIERS = [
    ("Simba Cement Distributors Ltd", "James Mwangi", "+254 722 145 890", "Nairobi", "Cement & building materials", "NET_15", 5),
    ("Twiga Welding & Steel Supplies", "Grace Njeri", "+254 733 812 465", "Thika", "Steel bars, sheets, welding consumables", "NET_30", 4),
    ("Nairobi Tools Wholesale Ltd", "Peter Otieno", "+254 720 664 233", "Nairobi", "Power & hand tools wholesale", "NET_30", 4),
    ("Crown Paints Depot - Central", "Sarah Kimani", "+254 711 903 577", "Nakuru", "Paints, varnishes and finishes", "IMMEDIATE", 4),
    ("Aqua Pipes & Fittings Ltd", "Daniel Kiptoo", "+254 736 220 118", "Nairobi", "Plumbing pipes, fittings, tanks", "NET_60", 3),
]

FIRST_M = ["James","John","Peter","Paul","Simon","Daniel","Samuel","Brian","Kevin","Dennis","Michael","Joseph","Charles","Patrick","Francis","Anthony","Victor","Eric","Collins","Elijah"]
FIRST_F = ["Mary","Grace","Lucy","Sarah","Esther","Jane","Alice","Beatrice","Faith","Joyce","Ruth","Naomi","Caroline","Susan","Rebecca","Anne","Diana","Janet","Cynthia","Purity"]
LAST = ["Kamau","Njoroge","Otieno","Achieng","Wanjiku","Mutua","Kiptoo","Chebet","Odhiambo","Wafula","Muthoni","Cheruiyot","Omondi","Njoki","Barasa","Atieno","Kariuki","Wambui","Korir","Ochieng","Mwangi","Nduta","Kilonzo","Nyambura","Juma","Moraa","Kimani","Nyakio","Maina","Awuor"]
ESTATES = {
    "Juja": ["Juja Town","Kalimoni","Makongeni","Kilimambogo Rd","Gachororo","Thika Road Koma"],
    "Nairobi": ["Kilimani","South B","Umoja","Buruburu","Langata","Kasarani","Embakasi","Westlands"],
    "Nakuru": ["Milimani","Free Area","London Estate","Section 58","Naka Estate","Barnabas"],
    "Ruiru": ["Ruiru Bypass","Gatongora","Kiu River","Mwihoko","Kimbo","Membley"],
    "Thika": ["Section 9","Makongeni","Gasorone","Kiangombe","Landless","Jamhuri Estate"],
}
PHONE_PREFIX = ["0722","0723","0724","0733","0734","0711","0712","0745","0790","0799","0768","0759"]

import random
def rng_for(seed):
    return random.Random(seed)
