#!/usr/bin/env python3
"""Monte Carlo pricing verification for SNAPLINE (companion to test/pricing.test.ts)."""

import math
import random

MON = 0.1


def erf(x):
    s = -1 if x < 0 else 1
    x = abs(x)
    t = 1 / (1 + 0.3275911 * x)
    y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * math.exp(-x * x))
    return s * y


def ncdf(x):
    return 0.5 * (1 + erf(x / math.sqrt(2)))


def start_window_prob(x, sigma, dur, a, b):
    if a <= x <= b:
        return 1
    c = min(0.35 * sigma, 0.5826 * sigma * math.sqrt(MON))
    a2, b2 = a + c, b - c
    sd = sigma * math.sqrt(max(dur, 1e-9))
    d = x - b2 if x > b2 else a2 - x
    return min(1, 2 * ncdf(-max(d, 0) / sd))


def touch_prob(S, sigma, T1, T2, a, b):
    if T2 <= 0:
        return 0
    T1 = max(T1, 0)
    dur = T2 - T1
    if T1 < 1e-9:
        return min(0.9999, max(1e-4, start_window_prob(S, sigma, dur, a, b)))
    sd1 = sigma * math.sqrt(T1)
    p, ws = 0, 0
    for i in range(41):
        z = -4 + 8 * i / 40
        w = math.exp(-0.5 * z * z)
        ws += w
        p += w * start_window_prob(S + sd1 * z, sigma, dur, a, b)
    return min(0.9999, max(1e-4, p / ws))


def gauss():
    u = v = 0
    while not u:
        u = random.random()
    while not v:
        v = random.random()
    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)


def mc_touch(S, sigma, T1, T2, a, b, paths=60000):
    dur = T2 - T1
    if dur <= 0:
        return 0
    dt = MON
    steps = math.ceil(dur / dt)
    hits = 0
    for _ in range(paths):
        x = S
        if T1 > 1e-9:
            for _ in range(math.ceil(T1 / dt)):
                x += sigma * math.sqrt(dt) * gauss()
        hit = a <= x <= b
        for _ in range(steps):
            if hit:
                break
            x += sigma * math.sqrt(dt) * gauss()
            hit = a <= x <= b
        if hit:
            hits += 1
    return hits / paths


def main():
    cases = [
        (100, 0.4, 0, 5, 98, 102),
        (100, 0.4, 2, 7, 97, 103),
        (105, 0.6, 1, 6, 100, 110),
    ]
    worst = 0
    for S, sig, T1, T2, a, b in cases:
        q = touch_prob(S, sig, T1, T2, a, b)
        mc = mc_touch(S, sig, T1, T2, a, b)
        err = abs(q - mc)
        worst = max(worst, err)
        print(f"S={S} σ={sig} quad={q:.4f} mc={mc:.4f} err={err:.4f}")
    assert worst < 0.005, f"worst err {worst}"
    print("PASS — quadrature within 0.005 of 60k-path MC")


if __name__ == "__main__":
    main()
