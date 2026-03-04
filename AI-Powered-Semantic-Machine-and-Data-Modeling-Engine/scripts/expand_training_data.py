"""Expand the training dataset to 105 pairs total."""
import json, os

# Load existing pairs
src = os.path.join(os.path.dirname(__file__), "..", "data", "raw", "text_pairs_english.json")
with open(src, "r", encoding="utf-8") as f:
    existing = json.load(f)

NEW_PAIRS = [
    {
        "anchor": "I lost my silver MacBook Pro laptop in the conference room B on the second floor yesterday afternoon. It is a 14-inch MacBook Pro M2 with a small dent on the bottom left corner. Has a matte screen protector applied and a Star Wars sticker on the cover.",
        "positive": "Silver Apple MacBook Pro laptop found in conference room B second floor this morning. It is a 14 inch model with apparent damage on one corner of the base. Screen has a protective film and there is a decorative sticker featuring movie characters on the lid. Device is password protected."
    },
    {
        "anchor": "Lost my Kindle e-reader in the campus coffee shop near the window seat. It is a Kindle Paperwhite in black with a blue fabric cover. There is some highlighting in several books downloaded on it.",
        "positive": "Black Kindle e-reader device found at campus cafe near window tables. Has a blue cloth protective cover case. The device is functional and appears to have multiple books loaded. Kept at cafe counter for owner to collect."
    },
    {
        "anchor": "My iPad Air was left on the bus route 138 this morning. It is a space gray iPad Air 5th generation with a navy blue smart folio keyboard case attached. Screen has no damage and there is a university sticker on the back of the case.",
        "positive": "Apple iPad tablet found on city bus this morning. It is a gray colored iPad with attached keyboard cover in dark blue color. The case has a university logo sticker on it. Device is locked. Currently being held at the bus depot lost and found office."
    },
    {
        "anchor": "I lost my portable Bluetooth speaker JBL brand in the park near the basketball court yesterday evening. It is a JBL Flip 5 in teal blue color. Cylindrical shape with a carabiner hook attached to the strap. Has some minor scratches on the bottom from outdoor use.",
        "positive": "JBL portable Bluetooth speaker found near basketball court in the park this morning. Teal blue cylindrical speaker with attached clip on the carrying loop. Shows some wear marks on the base. Speaker is still charged and functional. Available for pickup at park management office."
    },
    {
        "anchor": "Missing my Nintendo Switch gaming console left in the student lounge area. It has a gray body with neon blue and neon red Joy-Con controllers attached. There is a tempered glass screen protector and a small Pikachu sticker on the back. The device was in sleep mode when I left it.",
        "positive": "Nintendo Switch gaming device discovered in student common room on the couch. Gray console with colorful controllers one blue one red attached to the sides. Has a screen protector applied and a Pokemon character sticker on the rear. Device appears to be in standby mode. Secured at student affairs office."
    },
    {
        "anchor": "Lost my brown leather messenger bag on the train from Colombo to Kandy this morning. It is a vintage style brown leather crossbody bag with brass buckle closure. Contains my laptop sleeve a few books and an umbrella. The strap is adjustable and has some wear on the edges.",
        "positive": "Brown leather satchel style bag found on the Colombo to Kandy train service this morning. Features brass metal buckle fastening and crossbody carrying strap showing edge wear. Contains a padded electronics sleeve several books and a folding umbrella. Bag appears to be high quality genuine leather in vintage design. Currently held at Kandy station master office."
    },
    {
        "anchor": "I dropped my gym bag somewhere between the parking lot and the fitness center entrance this morning. It is a black Nike duffel bag medium size with a white Nike swoosh logo on the side. Inside there are my workout clothes, a pair of white Nike Air Max shoes, a towel, and my protein shaker bottle with a green lid.",
        "positive": "Black Nike sports duffel bag found near fitness center parking area. Medium sized bag with white brand logo printed on the side. Contains athletic clothing items, a pair of white Nike shoes, a bath towel, and a drink mixer bottle with green colored cap. Bag is being stored at gym reception desk."
    },
    {
        "anchor": "Lost my passport and travel documents in a clear plastic folder at the airport departure terminal near gate 7 this morning. The folder contains my Sri Lankan passport, boarding pass for Emirates flight EK653, hotel booking confirmation printout, and a photocopy of my travel insurance. The passport is relatively new issued in 2023.",
        "positive": "Clear plastic document folder found at airport departure area near boarding gates this morning. Contains a Sri Lankan passport that appears recently issued along with airline boarding documents for an Emirates flight, hotel reservation papers, and insurance documentation. All documents are being held at airport security lost property counter."
    },
    {
        "anchor": "Missing my prescription medication bag that I left at the pharmacy waiting area in the hospital. It is a small white plastic bag with the hospital pharmacy label. Inside there are three boxes of medication, my prescription paper with doctor details, and my health insurance card from a private insurer.",
        "positive": "Small white pharmacy bag found at hospital pharmacy waiting area containing prescription medication boxes and medical documents including a prescription note and insurance card. Bag has hospital pharmacy branding label attached. Items are being stored securely at pharmacy counter for patient retrieval."
    },
    {
        "anchor": "I lost my camera lens at the botanical garden yesterday while taking photographs near the orchid house. It is a Canon EF 50mm f1.8 prime lens with a black lens cap. The lens is relatively small and lightweight. There are no scratches on the glass but the outer barrel has a small scuff mark.",
        "positive": "Canon camera lens found in the botanical garden near the flower exhibition area. It is a compact prime lens with 50mm marking visible on the barrel. Comes with front lens cap in black. The optics appear clean and undamaged but there is minor cosmetic damage on the exterior. Lens is available at garden information center."
    },
    {
        "anchor": "Lost my electric scooter charger at the office bike parking area. It is a black rectangular power brick with a three-pin connector and a thick cable about 1.5 meters long. The charger is for a Xiaomi electric scooter and has the Xiaomi logo printed on the casing.",
        "positive": "Electric scooter charger unit found at office building bicycle parking zone. Black box shaped power supply with thick charging cable and three-prong plug connector. Has Xiaomi branding visible on the charger body. Cable length is approximately one and a half meters. Item being held at building facilities management office."
    },
    {
        "anchor": "My green Fjallraven Kanken backpack is missing from the university library coat hooks. It has the classic square shape with the orange and yellow Fjallraven logo on the front. Inside I had my laptop a water bottle and my planner diary for the year.",
        "positive": "Green Fjallraven backpack found hanging near library entrance area. Square shaped design with characteristic brand fox logo in orange tones on the front pocket. Contains a laptop computer, drink bottle, and a yearly planner notebook. Backpack is in good condition. Currently being held at library circulation desk."
    },
    {
        "anchor": "I lost my wedding ring in the restroom near the food court at City Mall. It is a plain gold band about 5mm wide. The inside has an engraving with our wedding date 15-06-2019 and our initials R and S with a heart symbol between them.",
        "positive": "Gold wedding band ring discovered in shopping mall restroom near food court area. Plain yellow gold ring approximately 5 millimeters wide. Has engraved text and symbols visible on the inner surface including what appears to be a date and letters with a heart shape. Ring is being kept securely at mall customer service counter."
    },
    {
        "anchor": "Lost my AirPods Pro in the white charging case at the university gym yesterday. The case has a small crack on the hinge area and I had put a tiny red dot sticker on the front to identify it. The AirPods have silicone ear tips in medium size installed.",
        "positive": "Apple AirPods Pro in white case found at university gym facility near the stretching area. The charging case shows damage near the opening hinge. There is a small red sticker mark on the front of the case. Earbuds inside have medium sized silicone tips attached. Item available for pickup at gym lost and found counter."
    },
    {
        "anchor": "Missing my university student ID card somewhere between the engineering building and the main cafeteria. It is a standard university ID with my photo, student number starting with EN2021, and a barcode on the back. The card is in a clear plastic card holder with a blue lanyard attached.",
        "positive": "University student identification card found on the walkway between engineering block and cafeteria. Card has student photo and identification number beginning with EN2021 printed on the front with barcode on reverse side. Located inside a transparent plastic sleeve with blue neck strap. Card available at university security office."
    },
    {
        "anchor": "I lost my external hard drive at the computer lab in building C room 302. It is a Western Digital My Passport 2TB portable hard drive in blue color. Very thin and lightweight. Has a short USB cable attached to it. The drive contains all my research data and thesis backup files.",
        "positive": "Portable external hard drive found in computer lab room 302 building C. It is a thin WD branded portable storage device in blue color with attached USB connection cable. Appears to be a 2 terabyte model based on the label. Device currently being held at IT department office for owner to collect with verification."
    },
    {
        "anchor": "Lost my leather journal diary near the park bench by the main fountain yesterday evening. It is a brown leather bound journal A5 size with an elastic band closure. Inside are my personal writings, sketches, and some pressed flowers between pages. The cover has a tree of life design embossed on the front.",
        "positive": "Brown leather notebook discovered on bench near fountain in the park yesterday night. A5 sized journal with elastic band for closure and decorative tree pattern embossed into the leather cover. Contains handwritten entries with drawings and some dried botanical specimens between pages. Available at park security kiosk."
    },
    {
        "anchor": "My wireless mouse is missing from the library computer desk I was using. It is a Logitech MX Master 3 in graphite gray color. Ergonomic design with a steel scroll wheel. The mouse has a USB-C charging port and was paired with my laptop. There is a small piece of tape on the bottom with my name written on it.",
        "positive": "Logitech wireless computer mouse found at library computer station. Gray colored ergonomic design mouse with metal scroll wheel. Has USB-C charging port. There is adhesive tape on the underside with handwritten name. Mouse is currently at the library help desk for owner to retrieve."
    },
    {
        "anchor": "I lost my camping headlamp somewhere on the hiking trail near the summit viewpoint area. It is a black Petzl headlamp with adjustable elastic headband in orange color. The lamp has multiple brightness settings and was set on the medium mode. Battery compartment on the back uses 3 AAA batteries.",
        "positive": "Headlamp found on hiking trail near summit viewing area. Black lamp unit with orange elastic adjustable strap. Appears to be Petzl brand outdoors headlamp with multiple light modes. Battery compartment on rear uses small batteries. Lamp is functional and currently being held at trail ranger station."
    },
    {
        "anchor": "Lost my tennis racket at the university sports complex court number 3 yesterday afternoon. It is a Wilson Blade 98 in black and green color scheme. The handle has a white overgrip that is slightly worn. String tension was recently adjusted. The racket was inside a black Wilson racket cover bag.",
        "positive": "Tennis racket discovered at sports complex near court area yesterday evening. Wilson brand racket in black with green accents inside a black branded carrying sleeve. Handle grip is white colored showing some usage wear. Strings appear to be in good condition and recently maintained. Available at sports complex equipment room."
    },
    {
        "anchor": "Missing my power bank since this morning from the lecture hall. It is an Anker PowerCore 20000mAh portable charger in white color. It has 2 USB output ports and a micro-USB input for charging. The power bank has 4 LED indicator lights on the side showing charge level. There is a small scratch on the front surface.",
        "positive": "White portable power bank found in lecture hall after morning classes. Anker brand high capacity portable charger with dual USB ports and LED charge indicators on the side. Surface has minor cosmetic scratches. Device still has charge remaining based on indicator lights. Available at lecture theatre reception desk."
    },
    {
        "anchor": "I lost my violin in a black hard case at the music room building third floor. The violin is a full size 4/4 with maple wood body and spruce top. The case contains the violin, bow, rosin block, and a small cloth for cleaning. The case has a shoulder strap and two combination locks. My name sticker is inside the case lid.",
        "positive": "Violin instrument in black rigid protective case found in music building third floor practice room. Full sized classical string instrument with wooden construction. Case includes the violin itself along with playing bow, rosin accessory, and cleaning cloth. Case features shoulder carrying strap and two combination lock closures. Name label visible inside case cover. Instrument kept safely at music department staff office."
    },
    {
        "anchor": "Lost my yoga mat at the community hall after the evening yoga session. It is a purple Manduka Pro yoga mat 6mm thick and 180cm long. The mat is quite heavy and dense compared to regular mats. It was rolled up and secured with a black elastic strap. One end has a small tear from regular use over two years.",
        "positive": "Purple yoga mat found at community hall after evening activities. Thick professional grade mat from Manduka brand approximately 6mm thickness and full length size. Mat is notably heavier than standard yoga mats. Secured with black elastic band when rolled. Shows minor damage on one end from extended usage. Available for collection at community hall front office."
    },
    {
        "anchor": "My bicycle helmet is missing from the bike rack area outside the library. It is a white Giro cycling helmet with adjustable dial on the back. Has ventilation holes across the top and some reflective stickers I added to the sides for visibility. The chin strap is black nylon with a magnetic buckle closure.",
        "positive": "White cycling helmet found near bicycle parking area outside library building. Adjustable fit dial mechanism visible on the rear. Multiple ventilation openings across the crown. Has reflective adhesive strips on both sides. Black chin strap with magnetic buckle fastener. Appears to be Giro brand based on design. Helmet available at library security booth."
    },
    {
        "anchor": "I left my electric toothbrush in the hostel bathroom on floor 4. It is a Philips Sonicare electric toothbrush in white and mint green color. The brush head has a blue indicator bristle that has started fading. Comes with a white plastic travel case.",
        "positive": "Electric toothbrush found in fourth floor hostel bathroom. White and green colored Philips Sonicare brand with brush head showing used blue indicator bristles. Comes with white travel storage case. Item currently at hostel warden office."
    },
    {
        "anchor": "Lost my thermos flask on the morning shuttle bus from campus to downtown. It is a 500ml vacuum insulated flask in matte black color from Zojirushi brand. The flip open lid has a lock mechanism. There is a cork coaster attached to the bottom with a rubber band that I use at my desk.",
        "positive": "Black insulated thermos bottle found on campus shuttle bus. Approximately 500ml capacity with flip-top locking lid. Zojirushi branded vacuum flask in matte black finish. Has a round cork pad attached to the base with elastic band. Available at transport office."
    },
    {
        "anchor": "Missing my makeup bag from the university women's restroom on ground floor. It is a small pink floral print cosmetics pouch with a gold zipper. Inside there are my foundation compact, mascara, lipstick in shade coral, eyebrow pencil, and a small mirror. The brand on the pouch is Kate Spade.",
        "positive": "Small pink patterned cosmetics bag found in ground floor ladies restroom. Floral design with gold colored zipper closure. Contains various makeup items including compact powder, eye makeup, lip color product, brow pencil, and pocket mirror. Pouch appears to be from a designer brand. Kept at reception desk."
    },
    {
        "anchor": "I lost my drone at the open field near the engineering faculty building. It is a DJI Mini 3 Pro small drone in gray color with orange propeller guards attached. The controller and a spare battery are in a gray DJI carrying case that was left on the ground near the takeoff point.",
        "positive": "Small drone and carrying case found at open grounds near engineering building. Gray colored DJI compact drone with orange safety guards on propellers. Accompanying gray branded case containing controller handset and additional battery pack. Drone and accessories available at engineering department office."
    },
    {
        "anchor": "Lost my sketchbook with charcoal pencil set at the art studio room 201 yesterday. The sketchbook is A3 size with a hard black cover and spiral binding on the left side. Contains about 40 pages of my figure drawing studies. The charcoal set is in a metal tin case with 12 sticks of varying hardness grades.",
        "positive": "Large A3 spiral-bound sketchbook with black cover discovered in art studio 201. Contains detailed figure drawing artwork throughout approximately half the pages. Found alongside a metal tin case with assorted charcoal drawing sticks. Both items preserved at art department faculty office for owner collection."
    },
    {
        "anchor": "My electric guitar tuner clip is missing from the rehearsal room. It is a small black Snark clip-on tuner that attaches to the headstock. The screen display rotates and the clip has a rubber padding to avoid scratching. Battery was working last time I used it.",
        "positive": "Small black clip-on guitar tuner found in band rehearsal room. Snark brand digital tuner with rotating display screen and rubberized clip padding. Appears functional with battery charge. Available at music room equipment storage."
    },
    {
        "anchor": "I lost my leather gloves in the taxi from the airport to the hotel. They are brown genuine leather driving gloves with perforated knuckle holes and a snap button closure at the wrist. The lining is cashmere and they are size medium. The gloves were a birthday gift.",
        "positive": "Pair of brown leather gloves found in taxi cab. Premium quality driving style gloves with perforated detailing and snap button wrist closure. Interior has soft luxury lining. Size appears to be medium. Gloves are at the taxi dispatch office for owner to claim."
    },
    {
        "anchor": "Missing my Fitbit fitness tracker wristband from the swimming pool changing room. It is a Fitbit Charge 5 in black with a silicone sport band. The screen shows time and steps. I took it off before swimming and forgot to put it back on.",
        "positive": "Fitbit Charge fitness tracker found in pool changing area. Black colored device with silicone wrist strap. Digital display shows time and activity data. Band shows signs of regular daily wear. Currently being held at pool facility front desk."
    },
    {
        "anchor": "Lost my set of drawing markers at the design lab table 7. It is a set of 36 Copic markers in a black zippered carrying case. The markers are arranged by color family inside. Some of the most used markers like Cool Gray and Pale Cherry are positioned at the front.",
        "positive": "Set of professional drawing markers in black zip case found at design lab. Contains 36 Copic brand markers organized by color groups. Some frequently used markers positioned at front of case. Small decorative charm attached to the case zipper. Full marker set maintained at design lab instructor office."
    },
    {
        "anchor": "I lost my hearing aid at the auditorium during the morning seminar. It is a small beige colored behind-the-ear hearing aid from Phonak brand. The device has a clear plastic ear mold that fits inside the ear canal and a thin wire connecting to the BTE unit.",
        "positive": "Small beige hearing aid device found in auditorium seating area after seminar. Behind-the-ear model with transparent custom ear piece and connecting wire. Appears to be Phonak brand assistive hearing device. Currently kept safely at auditorium reception with careful handling."
    },
    {
        "anchor": "My dog's leash and collar were left at the campus pet-friendly zone near the main garden. The leash is a red nylon retractable leash about 5 meters extended. The collar is also red with a silver bone-shaped tag that has my pet's name Max engraved on it.",
        "positive": "Red pet leash and collar found at campus garden pet area. Retractable nylon leash in red color approximately 5 meters long. Matching red collar with metal bone-shaped identification tag engraved with pet name and contact phone number. Items available at campus security guardhouse."
    },
    {
        "anchor": "Lost my sewing kit at the textile workshop room in the fashion design building. It is a medium sized floral print fabric case that zips open to reveal organized compartments. Contains needles of various sizes, thread spools in 15 colors, measuring tape, fabric scissors, and pin cushion shaped like a tomato.",
        "positive": "Fabric sewing kit case found in fashion design textile workshop. Floral patterned zippered case containing organized sewing supplies including assorted needles, multicolored thread spools, measuring tape, cutting scissors, and a decorative tomato-shaped pin holder. Case at fashion department office."
    },
    {
        "anchor": "I lost my prescription sports goggles at the squash court in the recreation center. They are clear polycarbonate lenses with a black rubber strap. The lenses have my prescription built in for nearsightedness. The goggles are Bolle brand with anti-fog coating.",
        "positive": "Sports protective eyewear found at recreation center squash court. Clear goggles with black adjustable rubber headband strap. Appear to be prescription optical lenses with anti-fog treatment. Bolle brand markings visible. Goggles currently at recreation center front desk."
    },
    {
        "anchor": "Missing my USB flash drive from computer lab room 105. It is a red colored SanDisk 64GB USB 3.0 drive with a retractable connector. The drive has a small keyring hole but no keychain attached. Contains important project files and presentation slides.",
        "positive": "Red USB flash drive found in computer lab 105 near the workstation area. SanDisk brand 64GB capacity with retractable USB connector mechanism. Has a small loop for keychain attachment. Drive is currently being kept at IT help desk. Owner should describe contents to verify ownership."
    },
    {
        "anchor": "I left my guitar capo at the coffee house open mic event last night. It is a black metal Kyser quick-change capo for acoustic guitar. The spring mechanism is still strong and the rubber padding is in good condition. The capo has a small piece of red tape wrapped around one arm.",
        "positive": "Black metal guitar capo found at coffee house after open mic night. Spring-loaded quick change type capo appears to be Kyser brand. Rubber grip padding intact. Has small red tape marking on one of the arms. Available at coffee house bar counter."
    },
    {
        "anchor": "Lost my badminton racket bag at the indoor sports hall. It is a blue Yonex racket bag that holds up to 3 rackets. Inside are two Yonex Astrox rackets, a tube of Yonex Mavis shuttlecocks, and a small towel. The bag has a shoe compartment at the bottom.",
        "positive": "Blue Yonex badminton equipment bag found at indoor sports hall. Large bag designed for multiple rackets containing two Yonex rackets, tube of badminton shuttlecocks, and hand towel. Bag has separate shoe storage section at base and a name identification tag attached. Available at sports hall equipment counter."
    },
    {
        "anchor": "My reading glasses case is missing from the coffee shop near campus gate. The case is a brown leather hard case with a magnetic snap closure. Inside are my reading glasses with thin gold metal frames and oval shaped lenses.",
        "positive": "Brown leather eyeglass case found at coffee shop near university entrance. Hard case with magnetic closure containing gold framed oval shaped reading spectacles. An optician's business card is inside the case. Items stored at cafe counter for owner to claim."
    },
    {
        "anchor": "I lost my lab coat in the chemistry laboratory building second floor. It is a white cotton lab coat size medium with my name and student number embroidered on the left chest pocket in blue thread. The coat has some faded chemical stain marks on the right sleeve cuff.",
        "positive": "White laboratory coat found in chemistry lab second floor. Medium sized cotton coat with blue embroidered name and number on chest pocket area. Some discoloration staining visible on one sleeve near the cuff. Two writing pens attached to the front pocket. Coat being held at chemistry department stockroom."
    },
    {
        "anchor": "Missing my bicycle pump from the campus bike shelter area. It is a Topeak floor pump with a silver metal body and black handle. The pressure gauge at the top shows up to 160 PSI. Has both Presta and Schrader valve adapters attached.",
        "positive": "Bicycle floor pump found at campus bike parking shelter. Silver metallic body with black grip handle. Pressure gauge mounted on top reads up to 160 PSI. Dual valve head for different bicycle tube types. Heavy metal base plate for stability. Pump at campus security office."
    },
    {
        "anchor": "I left my chess set at the university game room near table 4. It is a wooden chess set with a folding board that stores the pieces inside. The pieces are Staunton style in cream and dark brown wood. Two pawns from the dark set have slightly chipped bases.",
        "positive": "Wooden chess set found in university recreation room near gaming tables. Folding board design with internal piece storage. Staunton design pieces in light and dark wood tones. Some pieces show minor base wear and chips. Board has protective felt backing. Chess set available at game room attendant desk."
    },
    {
        "anchor": "Lost my motorcycle helmet at the parking structure level 3 yesterday. It is a full-face helmet in matte black color from AGV brand with a tinted visor. The helmet has red and white stripes on both sides. Inside has a removable comfort liner.",
        "positive": "Full face motorcycle helmet found at parking building third level. Matte black AGV brand helmet with dark tinted face shield. Red and white racing stripe graphics on both sides. Removable interior padding liner. D-ring chin strap closure system. Large size. Helmet at parking security booth."
    },
    {
        "anchor": "My camping sleeping bag is missing from the bus luggage compartment on the Colombo to Galle route. It is a blue and gray Coleman rectangular sleeping bag rated for 10 degree Celsius. Comes in a cylindrical carrying stuff sack with a drawstring closure.",
        "positive": "Sleeping bag found in bus luggage storage on southern coast route. Blue and gray colored Coleman brand rectangular adult sleeping bag in cylindrical carry bag with drawstring top. Full length side zipper for entry. Rated for cool weather camping. Available at Galle bus station lost property."
    },
    {
        "anchor": "Lost my tripod at the university media studio during the video project shoot. It is a Manfrotto Befree Advanced carbon fiber travel tripod in black. Very lightweight but sturdy. The ball head has a quick release plate attached. One leg has a small piece of blue tape for identification.",
        "positive": "Black Manfrotto carbon fiber travel tripod found in university media production studio. Lightweight compact tripod with ball-type head mount and quick release plate mechanism. Fully extends to approximately one and a half meters height. One leg section has blue tape marking. Tripod being stored at media department equipment room."
    },
    {
        "anchor": "I lost my graphic tablet stylus pen during the digital art workshop. It is a Wacom Pro Pen 2 in black with two side buttons. The pen has a replacement nib installed that is slightly shorter than new. The pen grip has a rubberized texture.",
        "positive": "Wacom digital stylus pen found at art workshop area. Black pen with two programmable side buttons and rubber grip texture. Pen tip appears used. Also found nearby is a small black cylindrical pen holder containing replacement nib tips. Both items at digital arts lab instructor desk."
    },
    {
        "anchor": "Missing my geometry box from the mathematics tutorial room. It is a clear plastic Maped geometry set containing a metal compass with pencil attachment, 15cm metal ruler, 180 degree protractor, two set squares 45 and 60 degree, and an eraser.",
        "positive": "Transparent plastic geometry instrument set found in maths tutorial room. Maped brand containing metal drawing compass, metal ruler, protractor, two triangular set squares, and an eraser. Owner's name written on the case lid in marker. Set available at mathematics department office reception."
    },
    {
        "anchor": "I lost my pet carrier bag at the veterinary clinic waiting area. It is a navy blue soft-sided collapsible pet carrier for small dogs or cats. Has mesh windows on three sides for ventilation and a removable fleece pad inside. The carrier has wheels and a telescoping handle.",
        "positive": "Navy blue pet transport carrier found at veterinary clinic reception. Soft sided collapsible design with mesh ventilation panels on multiple sides. Features rolling wheels and extendable pull handle. Internal detachable cushion liner included. No animal inside. Carrier being kept at clinic front desk."
    },
    {
        "anchor": "Lost my gardening tool set at the community garden plot number 12. It consists of a small hand trowel, cultivator rake, and pruning shears all with green rubber-coated handles. They were inside a khaki canvas tool roll pouch with a leather tie closure.",
        "positive": "Set of three garden hand tools found near plot area at community garden. Green handled trowel, rake, and pruning scissors in a khaki roll-up canvas storage pouch with leather strap. One tool blade shows impact damage. Tools available at community garden shed with the coordinator."
    },
    {
        "anchor": "My first aid kit is missing from the hiking group's rest stop near the waterfall trail marker. It is a red nylon pouch with a white cross symbol on the front. Contains bandages, antiseptic wipes, pain relievers, tweezers, and emergency contact information card.",
        "positive": "Red medical first aid pouch found at waterfall hiking trail rest area. Red nylon fabric bag with white cross medical symbol on front. Contains standard first aid supplies including bandages, sanitizing wipes, medication tablets, medical tweezers, and an emergency contacts card. Small compass keychain on the zipper. Currently at trail starting point information booth."
    },
    {
        "anchor": "I lost my compact travel umbrella at the train station platform 2 during the rain yesterday evening. It is a small dark green umbrella with automatic open mechanism. The handle is black with a wrist strap. The umbrella canopy has a subtle plaid pattern visible when opened.",
        "positive": "Small green folding umbrella found on train platform 2 yesterday. Automatic push button opening mechanism with black handle and wrist loop strap. Canopy fabric has checkered pattern design. Very compact when folded approximately 25cm length. Umbrella being kept at station master office."
    },
    {
        "anchor": "Lost my electric razor in the gym locker room. It is a Braun Series 9 electric shaver in silver and black. The shaver has a travel lock feature and was in a black zippered travel pouch. Battery was about 70 percent charged.",
        "positive": "Electric shaver found in gym men's locker room. Silver and black Braun premium electric razor in a black carrying pouch with zipper. Device has travel safety lock and appears to have substantial battery charge. Cleaning indicator visible. Available at gym front desk."
    },
    {
        "anchor": "I lost my piano lesson sheet music binder at the music conservatory practice room 5. It is a thick black three-ring binder containing about 60 pages of classical piano sheet music including Chopin nocturnes and Beethoven sonatas. The pages are plastic-sleeved for protection.",
        "positive": "Black ring binder with sheet music found in music conservatory practice room. Thick binder containing numerous pages of classical piano compositions in protective plastic page sleeves including works by well-known classical composers. Musical note sticker decoration on the binder spine. Available at conservatory reception area."
    },
    {
        "anchor": "Missing my snorkeling mask and snorkel from the beach changing area near the dive shop. The mask is a black silicone frame Cressi brand with tempered glass dual lenses and an adjustable head strap. The snorkel is a dry-top type in black and yellow.",
        "positive": "Snorkeling equipment found at beach changing facility. Cressi brand dive mask with black rubber frame and dual glass lenses on adjustable strap. Accompanying dry snorkel in black and yellow color scheme. Both items inside a clear mesh carry bag with drawstring. Available at nearby dive shop counter."
    },
    {
        "anchor": "I lost my portable projector at the meeting room in the coworking space on the fifth floor. It is a small white Anker Nebula Capsule mini projector about the size of a soda can. Cylindrical shape with a speaker grille around the bottom half.",
        "positive": "Mini portable projector found in fifth floor coworking meeting room. Small white cylindrical device approximately the size of a beverage can. Has speaker openings around the lower portion. Anker Nebula branding visible. Found with USB-C cable and gray fabric storage pouch. Currently at coworking space reception."
    },
    {
        "anchor": "Lost my skateboard at the campus skate park near the engineering building. It is an 8 inch wide deck with an Element brand design featuring a tree logo graphic on the bottom. The grip tape on top is black with some wear patches. The wheels are Spitfire brand 52mm white wheels.",
        "positive": "Skateboard found at university skate park area. 8 inch deck width with Element brand tree artwork on underside. Black grip tape showing usage wear on nose and tail kick areas. White 52mm wheels and silver trucks. Board appears well-used. Available at campus recreation center."
    },
    {
        "anchor": "I lost my photography memory card holder case at the photo exhibition venue. It is a small black Pelican case that holds 12 SD cards and 6 micro SD cards in foam cutout slots. Currently has 8 SD cards inside including SanDisk Extreme Pro 128GB cards.",
        "positive": "Small black protective case for camera memory cards found at photography exhibition hall. Hard shell case with foam insert holding multiple SD and micro SD format cards. Several high capacity SanDisk cards present. Case has waterproof seal design. Initials scratched into the base. Case secured at exhibition venue office."
    },
    {
        "anchor": "Missing my bamboo insulated lunch bag from the office kitchen area on the third floor. It is a medium sized insulated bag in olive green color with a bamboo lid that doubles as a cutting board. The bag contains a glass food container a set of bamboo cutlery and a cloth napkin.",
        "positive": "Green insulated lunch bag found in third floor office kitchen. Features bamboo top lid that serves as small board. Inside contains glass food storage container, set of bamboo eating utensils, and cloth napkin. Environmentally friendly lunch set. Available at floor reception area."
    },
    {
        "anchor": "I lost my climbing chalk bag at the bouldering wall in the adventure sports center. It is a purple fleece-lined drawstring chalk bag from Black Diamond brand. Has a belt loop and a carabiner clip attachment point. The bag still contains some loose chalk.",
        "positive": "Rock climbing chalk bag found at bouldering wall area in adventure center. Purple Black Diamond brand chalk bag with fleece interior and drawstring closure. Belt attachment loop and clip point present. Contains chalk residue and chalk ball. Available at adventure sports front desk."
    },
    {
        "anchor": "Lost my compact baby stroller at the shopping centre near the elevator on level 2. It is a compact navy blue Babyzen YOYO stroller that folds very small for travel. Has a rain cover attached and a small diaper bag hanging from the handle.",
        "positive": "Compact baby pushchair found near elevator area level 2 at shopping center. Navy blue Babyzen compact folding stroller with rain protection cover and small bag on the handlebar. Seat facing forward configuration. Front wheels show usage marks. Stroller secured at shopping center customer service desk."
    },
    {
        "anchor": "My archery arm guard was left at the outdoor range after practice. It is a brown leather forearm guard from Bear Archery with three elastic straps and brass snap buttons. The leather has been molded to my arm shape from use.",
        "positive": "Brown leather archery arm protector found at outdoor archery range. Three strap design with brass colored snap fasteners. Leather appears worn and shaped from regular use. Suede padded interior. Bear brand markings visible. Available at range equipment shed."
    },
    {
        "anchor": "I lost my Korean language textbook at the international student center study room. It is a blue covered Integrated Korean Beginning 1 textbook with my name and student ID written inside the front cover. The book has multiple sticky note tabs on various pages.",
        "positive": "Korean language textbook found in international center study area. Blue cover with Beginning level Korean course material inside. Has student identification written on inside cover. Multiple colored sticky note page markers and highlighted text passages throughout. Handwritten notes in back pages. Book available at international center info desk."
    },
    {
        "anchor": "Lost my face shield and safety goggles in the woodworking shop after the weekend workshop. The face shield is a clear polycarbonate visor attached to an adjustable black headband from 3M brand. The safety goggles are clear with indirect ventilation.",
        "positive": "Workshop safety equipment found in woodworking shop after weekend class. Clear 3M face shield visor with black adjustable headgear and pair of clear ventilated safety goggles with elastic strap. Both stored in drawstring bag colored blue. Items maintained at workshop supervisor station."
    }
]

# Deduplicate: compare first 80 chars of anchor
existing_anchors = set(p["anchor"][:80] for p in existing)
added = 0
for pair in NEW_PAIRS:
    if pair["anchor"][:80] not in existing_anchors:
        existing.append(pair)
        existing_anchors.add(pair["anchor"][:80])
        added += 1

print(f"Existing: {len(existing) - added}, Added: {added}, Total: {len(existing)}")

with open(src, "w", encoding="utf-8") as f:
    json.dump(existing, f, indent=2, ensure_ascii=False)

print(f"Saved {len(existing)} pairs to {src}")
