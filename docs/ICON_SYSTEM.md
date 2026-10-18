# Icon System

Status: current as of v2.109.0.

Rules:

1. Every navigation item renders a Lucide React icon. `TAB_CONFIG` types the
   icon as a required `React.ElementType` — a nav item without an icon does
   not compile.
2. Workspace links (Branch Selector, Organization Console, Expert Console,
   Global Chat) render icons in both expanded and collapsed (icon-only with
   tooltip + aria-label) modes.
3. Icons are 14px (`h-3.5 w-3.5`) in the sidebar rail and 16px
   (`h-4 w-4`) in tab headers, matching the existing app style.
4. Active state uses the sidebar's existing highlight (background + text
   color + weight), never color alone; locked rows carry a lock glyph.
5. No decorative emojis are used as icons anywhere in navigation.

Mapping (v2.109.0 normalizations marked):

| Item | Icon |
| --- | --- |
| Dashboard | Home |
| POS | ShoppingCart |
| Catalog | Tag |
| Inventory | Package |
| Customers | Users |
| Transactions | ShoppingBag |
| Rentals | KeyRound |
| Suppliers | Truck |
| Purchase Orders | ClipboardList |
| Financial | BarChart3 |
| Analytics | LineChart |
| Reports | FileText |
| Gift Cards | CreditCard |
| Vouchers | Ticket |
| Invoices | Receipt |
| eTIMS | Building2 |
| Delivery | Truck |
| Credits | CircleDollarSign |
| Debt Mgmt / Debt Plans | BadgeDollarSign |
| Messaging | MessageSquare |
| Chat | MessagesSquare |
| Transfers | ArrowUpDown |
| Banking | Landmark |
| Loyalty | Award |
| Payroll | Wallet |
| People & Payroll (NEW v2.109.0) | UserCog |
| Data Exports | Database |
| Shift Scheduling | CalendarDays |
| Security | Shield |
| Admin | ShieldCheck (v2.109.0, was Settings) |
| Branch Selector | Building2 (v2.109.0, was ChevronsRight) |
| Organization Console | Network (v2.109.0, was ShieldCheck) |
| Expert Console | Gauge |
| Global Chat | MessagesSquare (chat icon, consistent with the Chat tab) |
| Expert Console Home action | Home |

Global Chat keeps `MessagesSquare`: it is the icon the app already uses
consistently for chat surfaces (sidebar link + Chat tab), and it is
unambiguously a chat icon.
