#!/usr/bin/env bash

# Source: https://stackoverflow.com/a/64309893
openssl req \
  -newkey rsa:4096 \
  -x509 \
  -nodes \
  -keyout dev.key \
  -new \
  -out dev.crt \
  -subj /CN=localhost \
  -extensions v3_new \
  -config <(cat /System/Library/OpenSSL/openssl.cnf \
  <(printf '[v3_new]\nsubjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth')) \
  -sha256 \
  -days 36500
