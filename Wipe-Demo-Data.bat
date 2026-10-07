@echo off
title MBUMAH HARDWARE POS - Go-Live Reset (demo data wipe)
color 0C

echo.
echo  ============================================================
echo    MBUMAH HARDWARE POS  -  GO-LIVE RESET
echo  ============================================================
echo.
echo  This deletes all DEMO / TRAINING sales data so the shop can
echo  start clean for real trading.
echo.
echo  KEPT   : staff logins, stores, products, stock levels,
echo            categories, accounts, tax settings
echo  DELETED: demo sales, payments, receipts, debts, chats,
echo            purchase orders, payroll, customers, suppliers
echo.
echo  CLOSE THE POS WINDOWS BEFORE CONTINUING.
echo.

node "%~dp0deploy\nodocker\wipe-demo-data.mjs" %*

echo.
pause
