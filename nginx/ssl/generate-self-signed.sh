#!/bin/sh
# ============================================================================
# MBUMAH HARDWARE POS — Generate Self-Signed SSL Certificate
# ============================================================================
# FOR TESTING ONLY — Browsers will show security warnings.
# For production, use Let's Encrypt (see SELF_HOSTING_GUIDE.md).
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Generating self-signed SSL certificate for testing..."
echo "Certificate will be valid for 365 days for localhost + common local IPs."
echo ""

# Generate a self-signed certificate with Subject Alternative Names
# that cover localhost and common private network IPs.
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout server.key \
  -out server.crt \
  -subj "/CN=mbumah-pos-local" \
  -addext "subjectAltName=DNS:localhost,DNS:mbumah-pos,IP:127.0.0.1,IP:10.0.0.1,IP:192.168.1.1"

chmod 644 server.crt
chmod 600 server.key

echo ""
echo "✅ Certificate generated:"
echo "   Certificate: $SCRIPT_DIR/server.crt"
echo "   Private Key:  $SCRIPT_DIR/server.key"
echo ""
echo "⚠️  Remember: self-signed certificates are for TESTING only."
echo "   Browsers will show security warnings. Use Let's Encrypt for production."
