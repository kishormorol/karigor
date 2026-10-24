/**
 * Ready-made ideas for common needs in Bangladesh. Each is an idea in plain words, written the way the guide asks
 * (every kind of person and what each may and may not do), within what a web app can do today: payments made by cash,
 * bKash or Nagad are recorded, not taken inside the app. Each credits the open-source app its features are modelled on;
 * no code is taken from them.
 */
export interface Starter {
  id: string;
  title: string;
  /** Who it is for, in a few words. */
  for: string;
  idea: string;
  basedOn: { name: string; repo: string }[];
}

export const STARTERS: Starter[] = [
  {
    id: "shop-counter",
    title: "Shop counter",
    for: "a grocery or stationery shop",
    idea: "A shop counter for my small grocery. I, the owner, add products with their prices in taka and how many are in stock. My two salesmen ring up sales on their phones: they pick products, the total adds up, and the customer pays by cash, bKash or Nagad (for bKash and Nagad they type the transaction ID). Each sale lowers the stock, and cancelling a sale puts the stock back. Salesmen cannot change prices or see the takings. I see each day's sales and takings by payment method, and a list of products running low. Later: buying stock from suppliers, and money customers owe us on credit (baki).",
    basedOn: [{ name: "Open Source POS", repo: "opensourcepos/opensourcepos" }],
  },
  {
    id: "pharmacy",
    title: "Pharmacy",
    for: "a medicine shop",
    idea: "A system for my pharmacy. I, the owner, record medicines with their generic name, company, price and the batches we receive, each with its expiry date and quantity. Salesmen sell from the oldest batch first, record the payment (cash, bKash or Nagad) and can note the doctor's prescription. A salesman cannot change prices, delete a sale or see the takings. I see sales and takings for each day, medicines running low, and batches that expire in the next 60 days. Later: purchase orders to suppliers, and returns of expired stock.",
    basedOn: [{ name: "OpenBoxes", repo: "openboxes/openboxes" }],
  },
  {
    id: "restaurant",
    title: "Restaurant orders",
    for: "a restaurant or cloud kitchen",
    idea: "Orders for my restaurant. I, the owner, keep the menu with prices in taka and can mark an item as finished for today. Waiters take an order for a table or a parcel, add items and send it to the kitchen. The kitchen sees open orders, oldest first, and marks each one ready. The cashier prints the bill, records how it was paid (cash, bKash or card) and closes the order. Waiters cannot give discounts; only I can. I see the day's sales, the best-selling items, and takings by payment method. Later: delivery orders with the customer's address and phone.",
    basedOn: [{ name: "TastyIgniter", repo: "tastyigniter/TastyIgniter" }],
  },
  {
    id: "online-shop",
    title: "Online shop",
    for: "a Facebook seller with their own site",
    idea: "My own online shop instead of only selling on Facebook. Customers browse products by category with photos, prices in taka and sizes, add them to a cart and place an order with their name, phone and delivery address. They choose cash on delivery, or bKash and type the transaction ID. My staff confirm each order, check bKash payments, and move it through packed, sent with the courier, delivered or returned. Staff cannot change prices or products; only I can. I see orders by status, sales by day, and products running out. Later: discount codes, and a page where customers track their order with their phone number.",
    basedOn: [{ name: "Bagisto", repo: "bagisto/bagisto" }],
  },
  {
    id: "cash-book",
    title: "Cash book",
    for: "a small business or a household",
    idea: "A cash book for my business. I and my manager record money coming in and going out each day, with an amount in taka, a category (sales, rent, salary, electricity, supplies and so on), how it was paid (cash, bank, bKash) and a note. The manager can add entries and edit those from the last seven days, but cannot change older entries or delete any; I can edit anything. I see the balance in each account, this month against last month by category, and a chart of income and spending over the year. Later: monthly budgets for each category with a warning when one is nearly used up.",
    basedOn: [{ name: "Firefly III", repo: "firefly-iii/firefly-iii" }],
  },
  {
    id: "invoices",
    title: "Invoices and dues",
    for: "freelancers, agencies and suppliers",
    idea: "Invoices for my small agency. I keep our clients with their contact details. My accounts officer writes invoices with items, quantities and prices in taka, VAT where it applies, and a due date, then marks payments as they arrive, in part or in full, by bank, cheque or bKash. The accounts officer cannot delete an invoice once it is sent; only I can cancel it. I see who owes us what, invoices that are overdue, and money received this month. Later: quotations that turn into invoices, and expenses against each project.",
    basedOn: [{ name: "InvoiceShelf", repo: "InvoiceShelf/InvoiceShelf" }],
  },
  {
    id: "parts-stock",
    title: "Parts and stock",
    for: "spare-parts dealers and workshops",
    idea: "Stock for my motorcycle spare-parts shop. I keep parts with their part number, which models they fit, the shelf they sit on, buying price and selling price in taka. Staff record parts received from suppliers and parts sold or used in a repair. Staff can search for any part by number, name or model, but cannot change prices. I see stock on hand and its value, parts below their minimum, and which parts sell fastest. Later: a record of each repair job with the parts and labour charged.",
    basedOn: [{ name: "InvenTree", repo: "inventree/InvenTree" }],
  },
  {
    id: "samity",
    title: "Samity savings and loans",
    for: "a cooperative samity or NGO microcredit",
    idea: "A system for our savings samity. The manager enrols members with their name, NID number, phone and group, and sets each member's weekly savings amount. Field officers record each week's savings and loan instalments collected in their own groups, and cannot see other officers' groups. The manager gives loans with an amount in taka, a number of weekly instalments and a service charge, and the instalment schedule is worked out. Members' balances, savings and loans outstanding are always up to date. The committee sees total savings, loans outstanding, overdue instalments by officer, and collections each week. Later: member withdrawals, and yearly profit shared out by savings.",
    basedOn: [{ name: "Apache Fineract", repo: "apache/fineract" }, { name: "Mifos web app", repo: "openMF/web-app" }],
  },
  {
    id: "clinic",
    title: "Clinic",
    for: "a small clinic with several doctors",
    idea: "A system for my small clinic. The receptionist registers patients and books visits with our three doctors. Each doctor sees their own visits for the day and writes notes and prescriptions; the receptionist must not read the notes. The accountant takes payments in cash or bKash, prints a receipt, and sees what is still owed. I, the owner, see each day's visits and takings by doctor, with a chart for the month, and I add or remove staff. Later: lab tests with results attached to the visit.",
    basedOn: [{ name: "OpenEMR", repo: "openemr/openemr" }, { name: "Bahmni", repo: "Bahmni/openmrs-module-bahmniapps" }],
  },
  {
    id: "doctor-serial",
    title: "Doctor's serial",
    for: "a doctor's chamber",
    idea: "Serial booking for a doctor's chamber. The doctor sets which days and hours they sit and how many patients they see each day. The assistant books a serial for a patient with their name, age and phone, and on the day marks each patient as arrived, seen or absent. The assistant sees the list and the fees collected, but cannot read the doctor's notes. The doctor sees today's list in order and writes a short note and prescription for each patient. Later: a page where patients book their own serial with their phone number, and an SMS when their turn is near.",
    basedOn: [{ name: "Easy!Appointments", repo: "alextselegidis/easyappointments" }],
  },
  {
    id: "school",
    title: "School",
    for: "a kindergarten or private school",
    idea: "A system for our school. The office keeps students with their class, section, roll number and guardian's phone. Teachers take attendance for their own sections each morning and enter marks for their subjects after each exam; they cannot change another teacher's marks. Results and grades are worked out from the marks, and a printable result card is made for each student. The accountant records monthly fees paid by cash or bKash and sees who has not paid. The headteacher sees attendance and results for every class. Later: guardians sign in to see their child's attendance, results and fees.",
    basedOn: [{ name: "Gibbon", repo: "GibbonEdu/core" }, { name: "RosarioSIS", repo: "francoisjacquet/rosariosis" }],
  },
  {
    id: "madrasa",
    title: "Madrasa",
    for: "a madrasa with hifz and boarding",
    idea: "A system for our madrasa. The office admits students with their guardian's name and phone, their class, and whether they live in the boarding. Hifz teachers record each student's daily lesson: the para and pages memorised and revised, and how well they recited. Other teachers take attendance and enter exam marks for their own classes. The accountant records monthly tuition and boarding fees, and donations with the donor's name. Teachers cannot see the accounts. The muhtamim sees each student's hifz progress, attendance, fees owed, and the month's income and spending. Later: the boarding's meal attendance and costs.",
    basedOn: [{ name: "RosarioSIS", repo: "francoisjacquet/rosariosis" }],
  },
  {
    id: "coaching",
    title: "Coaching centre",
    for: "a coaching or tuition centre",
    idea: "A system for my coaching centre. I create batches (for example SSC science, morning) with their teacher, days and monthly fee in taka. The office admits students into batches and records fees paid by cash or bKash. Teachers take attendance for their own batches and enter marks for each class test; they cannot see the fees. Students sign in to see their attendance, marks and position in the batch. I see students owing fees, attendance by batch, and income this month. Later: model tests with merit lists across all batches.",
    basedOn: [{ name: "Moodle", repo: "moodle/moodle" }, { name: "Frappe LMS", repo: "frappe/lms" }],
  },
  {
    id: "library",
    title: "Library",
    for: "a school, college or community library",
    idea: "A system for our college library. The librarian catalogues books with title, author, subject, publisher and how many copies we have, and registers members (students and teachers). Assistants lend and take back books by searching for the member and the book; students may borrow two books for 14 days, teachers five for 30 days. Late returns add a fine in taka that the assistant records when paid. Assistants cannot remove books or members, or let a fine off; only the librarian can. Members sign in to search the catalogue and see what they have borrowed. The librarian sees overdue books, the most borrowed books, and fines collected. Later: members can reserve a book that is out.",
    basedOn: [{ name: "Koha", repo: "Koha-Community/Koha" }],
  },
  {
    id: "field-visits",
    title: "Household visits",
    for: "NGO field workers",
    idea: "A system for our NGO's community health workers. Supervisors register households in each worker's area with the head of household, members, ages and phone. Workers open their own households on their phones and record each visit: who they met, pregnant women and children under five, any danger signs, and advice given. A worker cannot see households outside their area. Supervisors see visits per worker each week, households not visited this month, and every visit with danger signs. The programme manager sees totals by area with charts, and can export them for reports. Later: follow-up reminders for households with danger signs.",
    basedOn: [{ name: "CommCare", repo: "dimagi/commcare-hq" }, { name: "KoboToolbox", repo: "kobotoolbox/kpi" }],
  },
  {
    id: "donors",
    title: "Donors and donations",
    for: "an NGO, mosque committee or foundation",
    idea: "A system for our foundation's donors. The office keeps donors with their name, phone, address and how they like to give. Staff record each donation with its amount in taka, date, method (cash, bank, bKash) and the project it is for, such as zakat, education or flood relief, and a receipt is made for each one. Staff cannot delete a donation once recorded. The treasurer sees donations by project and by month, and each donor's giving this year. The chairman sees the totals and the top projects. Later: spending recorded against each project, so we can show donors how their money was used.",
    basedOn: [{ name: "CiviCRM", repo: "civicrm/civicrm-core" }],
  },
  {
    id: "staff-leave",
    title: "Staff, leave and salaries",
    for: "an office or factory",
    idea: "A system for our office staff. HR keeps each employee's details, department, joining date and monthly salary in taka. Employees sign in to apply for leave (casual, sick or annual), see how much leave they have left, and see their salary slips. Each department head approves or refuses leave for their own team only. HR records attendance from the daily register and makes the month's salary sheet, with deductions for unpaid leave and any advance. Employees cannot see anyone else's salary. Management sees headcount, leave taken by department, and the salary bill each month. Later: overtime and festival bonuses.",
    basedOn: [{ name: "Frappe HR", repo: "frappe/hrms" }, { name: "OrangeHRM", repo: "orangehrm/orangehrm" }],
  },
  {
    id: "support-tickets",
    title: "Support tickets",
    for: "after-sales and customer support",
    idea: "Support for our electronics shop's customers. Customers fill in a form with their name, phone, the product, its serial number and the problem, and get a ticket number. Support staff see new tickets, take one, write notes, and move it through received, in repair, waiting for parts, ready for pickup and closed. Staff see all tickets but cannot change a ticket someone else has taken. The manager assigns tickets, sees open tickets by age and by staff member, and repairs done each week. Customers check their ticket's status by entering the ticket number and phone. Later: warranty checks by serial number and date of purchase.",
    basedOn: [{ name: "Zammad", repo: "zammad/zammad" }, { name: "Frappe Helpdesk", repo: "frappe/helpdesk" }],
  },
  {
    id: "leads",
    title: "Leads and follow-ups",
    for: "real-estate agents and sales teams",
    idea: "Leads for our flat-selling business. Sales agents add each enquiry with the buyer's name, phone, budget in taka, preferred area and flat size, and where they heard of us. Agents log every call and visit, set the next follow-up date, and move the lead through new, contacted, visited site, negotiating, booked or lost. Agents see only their own leads. The sales manager assigns leads, sees each agent's follow-ups due today, and the number of leads at each step. The owner sees bookings this month and which sources bring buyers. Later: our projects and flats, with which flats are still available.",
    basedOn: [{ name: "EspoCRM", repo: "espocrm/espocrm" }, { name: "Twenty", repo: "twentyhq/twenty" }],
  },
  {
    id: "guest-house",
    title: "Guest house bookings",
    for: "a hotel or guest house",
    idea: "Bookings for our guest house in Cox's Bazar. The manager sets up rooms with their type, number of beds and nightly rate in taka, higher on weekends and holidays. The front desk books rooms for guests with their name, phone and NID or passport number, checks them in and out, and records advance and final payments by cash or bKash. The front desk cannot change room rates. The manager sees which rooms are free on any date, occupancy for the month, and income by room type. Later: a page where guests see free rooms and send a booking request.",
    basedOn: [{ name: "QloApps", repo: "Qloapps/QloApps" }],
  },
  {
    id: "courier",
    title: "Parcel delivery",
    for: "a local courier",
    idea: "A system for our local delivery service. Merchants sign in to book parcels with the customer's name, phone, address, area and the cash-on-delivery amount in taka. The hub manager assigns parcels to riders by area. Riders see their own parcels for the day on their phones and mark each one delivered, partly delivered, returned or rescheduled, with the cash collected. Merchants see only their own parcels and what they are owed. The accountant records payments to merchants. The owner sees deliveries per rider and cash held by each rider. Later: delivery charges by area and weight.",
    basedOn: [{ name: "Fleetbase", repo: "fleetbase/fleetbase" }],
  },
  {
    id: "isp-billing",
    title: "Internet subscriber billing",
    for: "a local broadband ISP",
    idea: "Billing for our local internet service. The office keeps subscribers with their name, phone, address, area, connection date and package (speed and monthly price in taka). Each month a bill is made for every active subscriber. Line men record payments collected by cash or bKash in their own areas and cannot see other areas. The office marks subscribers as disconnected or reconnected. The owner sees collections this month, dues by area and by line man, and new and disconnected subscribers. Later: a page where subscribers see their dues with their phone number, and SMS reminders before the due date.",
    basedOn: [{ name: "daloRADIUS", repo: "lirantal/daloradius" }, { name: "PHPNuxBill", repo: "hotspotbilling/phpnuxbill" }],
  },
  {
    id: "farm-records",
    title: "Poultry farm records",
    for: "a poultry or fish farm",
    idea: "Records for my poultry farm. I set up sheds and each batch of birds with the date they arrived, how many, and what they cost in taka. The farm worker records each day's feed used, deaths, medicines and vaccines given, and eggs collected. The worker cannot see money. I record feed and medicine bought, and birds or eggs sold with the price. For each batch I see the birds left, feed per bird, deaths, costs, sales and profit, with charts over time. Later: a vaccine schedule for each batch with reminders.",
    basedOn: [{ name: "farmOS", repo: "farmOS/farmOS" }],
  },
  {
    id: "event-tickets",
    title: "Event registration",
    for: "seminars, fairs and reunions",
    idea: "Registration for our school's alumni reunion. People register with their name, phone, batch year and how many guests they bring; the fee in taka depends on the number of guests. They pay by bKash and type the transaction ID, and volunteers check each payment and confirm the registration, which gives a ticket code. On the day, volunteers check people in by searching the code or phone. Volunteers cannot change fees. The organisers see registrations by batch, money confirmed and pending, and how many have arrived. Later: t-shirt sizes and food choices for each guest.",
    basedOn: [{ name: "pretix", repo: "pretix/pretix" }],
  },
  {
    id: "garment-lines",
    title: "Garment production",
    for: "a garment factory or sewing unit",
    idea: "Production tracking for our garment factory. The merchandiser enters each buyer's order: style, colour, sizes, quantity and shipment date. The production manager splits an order across sewing lines and sets each line's daily target. Line supervisors enter each hour's output and any rejects with the reason, on their phones. Quality inspectors record checks for each batch. A supervisor sees only their own line and cannot change targets. The manager sees each line's output against target for today, orders at risk of missing their shipment date, and reject rates by line with charts. Later: cutting and finishing sections, and buyer reports to export.",
    basedOn: [{ name: "frePPLe", repo: "frePPLe/frepple" }],
  },
  {
    id: "factory-attendance",
    title: "Attendance and overtime",
    for: "a factory with shifts",
    idea: "Attendance and overtime for our factory workers. The HR officer adds workers with their ID card number, section, shift and basic wage in taka. Each morning and evening the section supervisor marks who came, who was late and who was absent, and records overtime hours. A supervisor sees only their own section and cannot change wages. At month end the HR officer sees each worker's days present, absences, late days and overtime hours, and the overtime pay at double the hourly rate, ready to export for the payroll sheet. The owner sees attendance by section with charts. Later: leave requests, and an SMS to the worker with their monthly summary.",
    basedOn: [{ name: "Horilla", repo: "horilla/horilla-hr" }],
  },
  {
    id: "health-reports",
    title: "Monthly health reports",
    for: "an upazila health office or NGO health programme",
    idea: "Monthly reporting for the health facilities in our upazila. The district officer sets up the facilities and the figures each one reports every month: antenatal visits, deliveries, children vaccinated, and cases of diarrhoea and pneumonia. Each facility's in-charge enters their figures for the month and submits them; after submitting they cannot change them without the officer reopening the report. A facility sees only its own reports. The officer sees which facilities have not reported this month, totals for the upazila with charts month by month, and can export the figures. On the 25th each month, facilities that have not reported get a reminder by SMS. Later: targets for each facility, and comparison with last year.",
    basedOn: [{ name: "DHIS2", repo: "dhis2/dhis2-core" }],
  },
  {
    id: "hospital-ward",
    title: "Hospital wards",
    for: "a small private hospital",
    idea: "Admissions and wards for our small hospital. The admission desk registers a patient with their name, age, guardian, phone and the doctor in charge, and gives them a free bed in a ward or cabin. Nurses see the patients in their own ward, record temperature, blood pressure and medicines given each shift, and note anything the doctor should know. Doctors write daily notes and orders for their own patients and can upload a test report as a photo or PDF. A nurse cannot discharge a patient or see the bills. The accounts desk adds bed charges each day, medicines and tests, and records payments in cash, bKash or card. At discharge the doctor writes a summary and the patient's bill is settled. The administrator sees beds free and taken, and today's admissions and discharges. Later: an operation theatre schedule.",
    basedOn: [{ name: "OpenMRS", repo: "openmrs/openmrs-core" }],
  },
  {
    id: "community-reports",
    title: "Community problem reports",
    for: "a ward councillor's office or a residents' society",
    idea: "A place for people in our ward to report problems: waterlogging, a broken road, a streetlight out, garbage not collected. Anyone can send a report from a public page with what is wrong, where it is in words (road and landmark), a photo, and their phone number. Office staff check each new report, put it in a category, and assign it to the right person. That person updates the status (seen, being fixed, fixed) and adds a photo when it is done. Staff cannot delete a report; only the councillor can, with a reason. The public page shows fixed and open problems without anyone's phone number. The councillor sees open problems by category and by area, and how long fixes take. Later: an SMS to the person who reported it when it is fixed.",
    basedOn: [{ name: "Ushahidi", repo: "ushahidi/platform" }],
  },
  {
    id: "documents",
    title: "Office documents",
    for: "an office, chamber or small company",
    idea: "A filing cabinet for our office's documents. Staff upload scanned papers, photos and PDFs: deeds, contracts, licences, letters and receipts. Each document gets a title, a date, a type, the client or party it belongs to, and tags, and can be found by searching any of these. Some documents are marked confidential: only partners can open those, and staff cannot see them in lists or searches. Licences and contracts can have an expiry date, and the office manager sees what expires in the next 30 days. Everyone can see who uploaded each document and when. Later: a daily reminder by email of documents about to expire.",
    basedOn: [{ name: "Paperless-ngx", repo: "paperless-ngx/paperless-ngx" }],
  },
  {
    id: "transport-fleet",
    title: "Transport fleet",
    for: "a truck, bus or rent-a-car company",
    idea: "Records for our transport business. The manager adds vehicles with their registration number, fitness and tax token expiry dates, and drivers with their licence expiry. For each trip the dispatcher records the vehicle, driver, from and to, the hire charge in taka and the advance paid. Drivers record fuel bought and road costs (tolls, parking) for their own trips, with a photo of the receipt. A driver sees only their own trips and cannot change hire charges. The owner sees income and costs per vehicle each month, the profit per vehicle with charts, and papers or licences expiring in the next 30 days. Later: servicing schedules, and an SMS to drivers before their licence expires.",
    basedOn: [{ name: "Fleetbase", repo: "fleetbase/fleetbase" }, { name: "Traccar", repo: "traccar/traccar" }],
  },
  {
    id: "distributor",
    title: "Distributor and sales reps",
    for: "a wholesale distributor or dealer",
    idea: "Orders and dues for our distribution business. I, the owner, keep the products with their trade price in taka, and the shops we supply, each on a route. Each sales representative (SR) visits the shops on their route, takes orders on their phone and records money collected. The delivery team sees today's orders by route, marks each delivered, and notes anything returned. An SR sees only their own shops and orders and cannot change prices or give credit beyond a shop's limit. The accountant records payments by cash, bKash or bank, and sees what each shop owes and for how long. I see sales by SR, route and product each month with charts, and the shops with the oldest dues. Later: targets and commission for each SR.",
    basedOn: [{ name: "ERPNext", repo: "frappe/erpnext" }],
  },
  {
    id: "farmers-coop",
    title: "Farmers' cooperative",
    for: "a farmers' group selling vegetables or fish",
    idea: "Weekly orders for our farmers' cooperative. Each week the coordinator opens an order cycle with the produce available, its price per kilo in taka, and the day orders close. Farmers in the group enter how much of each item they can supply this week. Customers (families, restaurants and shops) sign in and place orders until the cycle closes; they cannot change an order after that. When it closes, each farmer sees how much to bring, and the packing team sees a list per customer. Payments are recorded in cash or bKash on delivery. A farmer sees only their own supply and earnings. The coordinator sees sales per farmer and per item, and what each farmer is owed. Later: a reminder by SMS to customers when a new cycle opens.",
    basedOn: [{ name: "Open Food Network", repo: "openfoodfoundation/openfoodnetwork" }],
  },
  {
    id: "health-insurance",
    title: "Micro health insurance",
    for: "an NGO or cooperative running a health scheme",
    idea: "Membership and claims for our community health insurance scheme. Enrolment officers register households with each member's name, age and phone, and record the yearly premium paid in cash or bKash; a household is covered for a year from payment. Partner clinics look up a member by their card number, see whether they are covered, and send a claim for a visit with the treatment and cost, and a photo of the bill. Claims officers check each claim and approve it, or reject it with a reason. A clinic sees only its own claims and cannot approve them. The scheme manager sees members covered, premiums collected, claims paid by clinic, and households whose cover ends in the next month. Later: an SMS to households a week before their cover ends.",
    basedOn: [{ name: "openIMIS", repo: "openimis/openimis-be_py" }],
  },
  {
    id: "salon-bookings",
    title: "Salon and parlour bookings",
    for: "a beauty parlour, salon or spa",
    idea: "Bookings for our beauty parlour. I, the owner, list our services with how long each takes and its price in taka, and our beauticians with the days and hours they work. Customers book from a public page: they pick a service, a beautician or anyone free, and a time that is still open, and give their name and phone. Each booking gets an SMS confirming it, and a reminder the day before. The receptionist sees today's bookings, adds walk-in customers, marks who came, and records the payment in cash or bKash. A beautician sees only their own bookings and cannot see the takings. I see bookings and takings for each day and month, the busiest services, and customers who did not come. Later: packages for brides, and a customer's past visits.",
    basedOn: [{ name: "Cal.diy", repo: "calcom/cal.diy" }, { name: "Easy!Appointments", repo: "alextselegidis/easyappointments" }],
  },
  {
    id: "surveys",
    title: "Surveys",
    for: "a research team, NGO or union parishad",
    idea: "Surveys our field team fills in on their phones. A survey manager writes each survey: its questions in order, each one a short answer, a number, a date, a choice from a list, or a photo, and which questions must be answered. Enumerators see only the surveys assigned to them, fill in one response per household or person, and can save a response and finish it later. An enumerator cannot see other enumerators' responses or change a response after a supervisor has checked it. Supervisors check each response for their own team, send it back with a note if something is wrong, or accept it. The survey manager sees how many responses each enumerator has done, totals and charts for each question, and can export every response for a spreadsheet. Later: questions that only appear after a certain answer.",
    basedOn: [{ name: "ODK Central", repo: "getodk/central" }, { name: "KoboToolbox", repo: "kobotoolbox/kpi" }],
  },
  {
    id: "sms-notices",
    title: "SMS notices to groups",
    for: "a school, mosque committee, samity or housing society",
    idea: "SMS notices for our school. The office keeps contacts (parents, teachers and staff) with their name and phone, in groups such as a class, all teachers, or the managing committee; one person can be in several groups. The headteacher writes a notice, picks the groups, and sends it, or schedules it for a later day; the page shows how many SMS it will be. Every message is kept with whether it was sent or not, and why. Office staff can add and edit contacts and draft notices, but they cannot send a notice; only the headteacher can. The headteacher sees every notice sent, to how many people, and how many failed, and can send the failed ones again. Later: replies from parents, and a notice board page parents can open.",
    basedOn: [{ name: "textbee", repo: "textbee/textbee" }],
  },
];

export function findStarter(id: string): Starter | undefined {
  return STARTERS.find((s) => s.id === id);
}

/** The starter's idea, followed by the person's own changes when they give any. */
export function starterIdea(starter: Starter, changes?: string): string {
  const own = changes?.trim();
  return own ? `${starter.idea}\n\nMy changes to this: ${own}` : starter.idea;
}

/** The idea a new project starts from: the person's own words, or a starter with their changes. */
export function ideaFor(idea: string | undefined, starterId: string | undefined): string {
  if (starterId === undefined) {
    if (!idea?.trim()) throw new Error("describe your idea in your own words, or start from a ready-made one with --starter <id> (see karigor starters)");
    return idea;
  }
  const starter = findStarter(starterId);
  if (!starter) throw new Error(`there is no ready-made idea called "${starterId}"; karigor starters lists them`);
  return starterIdea(starter, idea);
}

export function renderStarters(): string {
  const width = Math.max(...STARTERS.map((s) => s.id.length));
  return [
    "Ready-made ideas. Start one with: karigor new --starter <id> \"your changes, in your own words\"",
    "Read one in full with: karigor starters <id>",
    "",
    ...STARTERS.map((s) => `  ${s.id.padEnd(width)}  ${s.title}, for ${s.for}`),
  ].join("\n");
}

export function renderStarter(starter: Starter): string {
  return [
    `${starter.title}, for ${starter.for}`,
    "",
    starter.idea,
    "",
    `Modelled on: ${starter.basedOn.map((b) => `${b.name} (github.com/${b.repo})`).join(", ")}`,
    "",
    `Start it as is:      karigor new --starter ${starter.id} --run`,
    `Or with changes:     karigor new --starter ${starter.id} "What is different for you, in your own words" --run`,
  ].join("\n");
}
