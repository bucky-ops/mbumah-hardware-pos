# Payroll Worked Examples

Hand-verifiable arithmetic for the EMS payroll engine (integer cents; rates in basis points; floor rounding per band and per line). The 2024-12-01 seeded rate tables are used throughout: PAYE 10/25/30/32.5/35 percent bands at 24,000 / 32,333 / 500,000 / 800,000 KES monthly; personal relief 2,400 KES; NSSF Tier I 6 percent of the first 8,000 KES and Tier II 6 percent of 8,000 to 72,000 KES with matching employer contributions; SHIF 2.5 percent of gross with a 300 KES minimum; Housing Levy 1.5 percent with a matching employer share. These examples are reproducible from src/lib/hr/payroll/fixtures/golden.json and are reviewable data, not legal advice.

## Example 1: 20,000 KES basic plus 10,000 KES house allowance

Gross = 3,000,000 cents. NSSF: Tier I 6 percent of 800,000 = 48,000; Tier II 6 percent of (2,000,000 - 800,000) = 72,000; total 120,000. SHIF 2.5 percent of 3,000,000 = 75,000. Housing 1.5 percent = 45,000. PAYE taxable = 3,000,000 - 120,000 = 2,880,000; band 1 tax 240,000 plus band 2 tax 120,000 = 360,000; minus relief 240,000 = 120,000. Deductions total 360,000. Net = 2,640,000 cents = 26,400.00 KES.

## Example 2: 100,000 KES basic (top-band reach)

Gross = 10,000,000 cents. NSSF caps: Tier I 48,000; Tier II 6 percent of 6,400,000 = 384,000; total 432,000. SHIF 250,000; Housing 150,000. Taxable = 9,568,000. Tax = 240,000 + 208,325 + 1,900,410 = 2,348,735; after relief 2,108,735. Net = 7,059,265 cents = 70,592.65 KES.

## Example 3: Casual worker, five days at 700 KES

Gross = 5 x 70,000 = 350,000 cents. NSSF is computed on basic salary (zero for casual engagements): 0. SHIF 8,750 is below the 30,000 minimum, so the minimum applies. Housing 5,250. PAYE taxable 350,000 gives 35,000, which the relief erases. Net = 314,750 cents = 3,147.50 KES.

## Example 4: Overtime, 250 KES hourly rate, one weekday hour at 1.5x

Overtime line = floor(25,000 x 1 x 1.5) = 37,500 cents, floored per line. Gross = 4,037,500 with 4,000,000 basic. NSSF on basic: 48,000 + 192,000 = 240,000. Taxable = 3,797,500; PAYE = 377,585. SHIF 100,937; Housing 60,562. Net = 3,258,416 cents = 32,584.16 KES.

## Example 5: Unpaid leave, four days of twenty-two

Proration factor = 18/22. Basic = floor(2,000,000 x 18 / 22) = 1,636,363 cents. NSSF: 48,000 + floor((1,636,363 - 800,000) x 0.06) = 48,000 + 50,181 = 98,181. SHIF 40,909; Housing 24,545. Taxable 1,538,182 produces 153,818 of tax, erased by relief. Net = 1,472,728 cents = 14,727.28 KES.

## Identity and audit notes

For every example: net = gross - total employee deductions exactly (roundingAdjustmentCents remains 0 because every statutory line floors at its own boundary). The journal debits gross to 5200 Salaries Expense plus employer shares to 5210/5215, and credits 2210/2215/2220/2225/2250/2240 payables; debits always equal credits. Payslips store the resolved rate table ids, so recomputation from archived tables reproduces these figures bit-for-bit.
