---
title: "The Hidden Light Eye: From Fire Detection to Predictive Maintenance"
description: "How we designed an indoor-light-powered fire warning system for heritage buildings—and used Isolation Forest, Prophet, and XGBoost to monitor the health of the sensors themselves."
pubDate: 2026-10-08
category: "项目"
tags: ["Feng Ru Cup", "Heritage Preservation", "Infrared Sensors", "Fault Detection"]
language: "en"
featured: false
draft: false
---

When you design a fire warning system for a timber heritage building, you immediately run into a practical tension. On one hand, drilling holes or pulling new power cables across historic beams is out of the question, so the sensor nodes need to be compact, wireless, and self-powered. On the other hand, **once you rely on tiny wireless nodes running on harvested indoor light, how do you know whether a quiet sensor is genuinely safe—or simply out of power and failing silently?**

In other words, a trustworthy warning system has to answer two questions at the same time: **Is there a sign of fire in the building, and are the sensors watching the building still healthy?** We built *Yinjian Qiedun (The Hidden Light Eye)* around both questions. In this post, I want to walk through how we structured the hardware, why we separated the two data pipelines, and what I learned while designing the three-stage predictive maintenance workflow.

**中文版本：** [幽鉴潜盾：从火情感知到设备预测性维护](/posts/hidden-light-eye-sensor-health/)

## 1. Hardware architecture: staying on watch without new wiring

### Field detector: infrared sensing and low-power telemetry

Each node mounted inside the building pairs an infrared temperature sensing element with a low-power wireless transmitter. The infrared sensor measures ambient thermal radiation and converts it into a digital temperature reading; the radio module packages that reading together with a unique device ID and sends it to a central receiver. Giving every node a fixed ID sounds trivial, but it is the anchor that lets us map an abstract anomaly score back to a specific beam or hall on the floor plan.

### Power module: balancing indoor light harvesting and storage

To avoid external wiring and frequent ladder climbs for battery swaps, we designed the power stage around a low-light photovoltaic cell, a storage battery, and an energy-management circuit with maximum power point tracking (MPPT). When ambient indoor light is available, harvested energy runs the node and tops up the battery; at night or in dim corners, the storage battery takes over seamlessly.

Looking back from an engineering standpoint, the real test of any energy-harvesting node is its **long-term power budget**: whether day-time light harvesting can consistently outpace sleep/wake sensor draw and radio transmissions across winter months. Our project prototype established the circuit architecture, while multi-month field discharge logs remain the next step before claiming maintenance-free runtime.

### Receiver: splitting fire alerts from device health

When packets arrive at the receiver, we deliberately split them into two parallel pipelines: one evaluates environmental temperature changes to trigger **fire warnings**, while the other inspects device telemetry to surface **maintenance prompts**. Keeping these two paths separate is essential—a low-battery or weak-signal alert is a ticket for a technician to check a node, never a false fire alarm that panics staff.

## 2. The fire-monitoring path: from infrared radiation to alarm

```text
Ambient infrared radiation in the hall
      ↓
Detector measures temperature and generates a digital signal
      ↓
Low-power wireless link encodes and sends reading + device ID
      ↓
Receiver evaluates temperature spikes and rate of rise
      ↓
Fire risk warning alerts staff to inspect and respond
```

On the fire-detection branch, the field node’s job is simply to measure and deliver reliably; the receiver evaluates whether temperature levels or rates of change cross risk criteria. In our competition paper we focused on the end-to-end signal path rather than locking in a single universal alarm temperature—because drafty timber halls and enclosed alcoves behave very differently, real deployments need site-specific sensor calibration to balance sensitivity against false alarms.

## 3. The self-check path: why we stacked three models

The part of the project I enjoyed designing most was the second pipeline: **how do we tell that a sensor node is degrading before it goes completely dark?**

Instead of adding extra diagnostic hardware, we used four operating metrics the node already knows about itself:

- **Voltage and current:** reflect photovoltaic charging and battery health;
- **Signal strength and response frequency:** capture wireless link quality and controller responsiveness;
- **Timestamp and device ID:** align readings into per-device time series;
- **Floor-plan location:** maps each device ID to its physical mounting spot.

We organized the self-check pipeline into three stages—anomaly screening, trend forecasting, and maintenance classification:

```text
Collect operating metrics + device IDs (e.g., every 1–2 hours)
      ↓
Clean timestamps, filter invalid packets, and build numeric features
      ↓
Isolation Forest: flag outlier readings that break normal patterns
      ↓
Prophet: project 24–48h trends for voltage and power health
      ↓
XGBoost: combine multi-metric features into a maintenance priority
      ↓
Link device ID to the building plan for targeted inspection
```

In our prototype workflow, nodes report health heartbeats every one to two hours: lightweight cleaning and outlier screening run locally first, while heavier trend forecasting and classification can run at the receiver or in the cloud.

### Step 1: Isolation Forest catches sudden outliers

When you first deploy a sensor network, you have zero labeled failure data. That is why we started with **Isolation Forest**, an unsupervised method that randomly splits features to see how quickly a data point gets isolated. Readings that look nothing like the rest of the fleet—a sudden voltage dip, an abnormally weak radio packet, or an odd combination of high current and sluggish response frequency—require very few splits and get flagged as `-1` (anomalous).

One important caveat we kept in mind: **a statistical outlier is not proof of a broken component.** Our Python prototype used `contamination=0.01` as a starting point, but in production that threshold has to be tuned against real false-alarm rates.

### Step 2: Prophet tracks slow voltage drift

Point-in-time outlier detection is great for sudden glitches, but it often misses slow, steady degradation—like dust settling on a photovoltaic cell so the battery loses a fraction of a volt every day. To catch gradual drift, we fed each node’s timestamp (`ds`) and voltage history (`y`) into **Prophet** to project a 24-to-48-hour forecast interval. If the projected trend line and lower bound keep sliding toward the cutoff voltage, staff get an early heads-up to clean the panel or check the battery.

Because Prophet shines on longer time series with daily or seasonal cycles, we also noted that newly installed nodes need a baseline warm-up period before short-horizon forecasts become reliable.

### Step 3: XGBoost prioritizes maintenance

Finally, we used **XGBoost** as a supervised classifier taking voltage, current, signal strength, and response frequency as inputs to predict `needs_maintenance`.

Working through this stage highlighted a classic machine-learning trap: **a supervised model is only as honest as its labels.** If training labels are generated purely from synthetic rules or fixed thresholds, XGBoost will simply memorize those rules. For the classifier to add real value in the field, technicians need to log what they actually found during inspections so confirmed repairs become the ground-truth training labels.

## 4. How the three models fit together in practice

Rather than duplicating one another, each method answers a different operational question:

| Stage | Method | Engineering question answered | Primary output |
|---|---|---|---|
| Outlier screening | Isolation Forest | Does this latest packet look unusual compared with normal operation? | Anomaly flag (-1/1) and score |
| Trend forecasting | Prophet | Where is this node’s voltage heading over the next 24–48 hours? | Forecast curve and confidence bounds |
| Maintenance triage | XGBoost | Given all metrics together, should we send someone to inspect this node now? | Normal vs. maintenance-needed class |

In our initial implementation, XGBoost trained directly on the four sensor metrics rather than consuming the Isolation Forest score or Prophet slope as input features. If I were extending this pipeline today, feeding the anomaly score and forecasted voltage slope directly into the classifier—and formalizing the feedback loop from technician repair logs—would be my very first upgrade.

## 5. Turning model flags into actionable inspection leads

An algorithm flagging `Device #14` is only useful if a staff member knows where `#14` is and what tool to bring. By binding every device ID to an interactive floor plan, hovering over a flagged node immediately shows its mounting location alongside its recent metric history: persistent low voltage points toward the low-light solar cell or storage stage, whereas weak RSSI or erratic response frequency points toward the radio link or sensing module.

Building *The Hidden Light Eye* taught me that hardware and AI in IoT systems are really two halves of the same reliability loop: low-power harvesting makes wireless deployment possible, and self-check telemetry makes sure that "out of sight" never turns into "silently offline."
