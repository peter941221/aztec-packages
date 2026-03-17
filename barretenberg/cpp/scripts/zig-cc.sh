#!/bin/bash
# Wrapper for zig cc that pins glibc 2.35 on Linux (Ubuntu 22.04+ compat)
# and uses native target on macOS.
# Use explicit architecture targets instead of 'native' to prevent zig from
# detecting host-specific CPU features (e.g. SVE on Graviton, AVX-512 on
# Sapphire Rapids) that would produce binaries incompatible with other machines.
# cmake's arch.cmake handles -march=skylake for x86; ARM gets baseline aarch64 (no SVE).
if [[ "$(uname -s)" == "Linux" ]]; then
  if [[ "$(uname -m)" == "aarch64" ]]; then
    exec zig cc -target aarch64-linux-gnu.2.35 "$@"
  else
    exec zig cc -target x86_64-linux-gnu.2.35 "$@"
  fi
else
  exec zig cc "$@"
fi
