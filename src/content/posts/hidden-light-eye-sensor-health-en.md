---
title: "The Hidden Light Eye: From Fire Detection to Predictive Maintenance"
description: "A complete guide to the heritage fire warning system: its hardware, two data paths, and how Isolation Forest, Prophet, and XGBoost support device self-checks."
pubDate: 2026-10-08
category: "项目"
tags: ["Feng Ru Cup", "Heritage Preservation", "Infrared Sensors", "Fault Detection"]
language: "en"
featured: false
draft: false
---

A fire warning system for a heritage building needs to answer two questions at once: **Is there a sign of fire in the building, and are the devices responsible for monitoring it still working reliably?** Yinjian Qiedun (The Hidden Light Eye), an AI fire warning platform powered by indoor light, was designed around both questions. It combines light harvesting, infrared temperature sensing, wireless communication, and an intelligent receiver. Alongside fire monitoring, it proposes device health monitoring and maintenance recommendations.

This article follows the system from its hardware and data flows to the roles of its three AI methods.

**中文版本：** [幽鉴潜盾：从火情感知到设备预测性维护](/posts/hidden-light-eye-sensor-health/)

## 1. System components

### Field detector: measure temperature and send readings

Each detector installed inside the building contains an infrared sensing element and a wireless transmitter. The infrared element receives environmental radiation and converts the measurement into temperature data and a digital signal. The wireless module encodes the data and sends it to a receiver over a low-power link. Each device needs a unique ID so the receiver can associate its readings with a location on the building plan.

### Power module: harvest indoor light and store energy

A low-light photovoltaic cell converts available light into electricity. The power management circuit supplies the detector and charges a storage battery. When light is available, the harvested energy can run the device and replenish the battery. At night or in low-light conditions, the storage battery continues to power the infrared sensor and wireless module. The project materials also mention maximum power point tracking (MPPT), which adjusts the photovoltaic operating point to improve energy harvesting under changing light conditions.

The goal is to reduce external wiring and frequent battery replacement, allowing small detectors to be installed where construction or maintenance is difficult. Reliable all-day operation still depends on the balance between light, power consumption, battery capacity, and radio transmission frequency. The materials describe the proposed system, but do not include long-term field records that would establish its actual runtime.

### Receiver: collect readings and issue two kinds of alerts

The receiver gathers temperature readings and device telemetry from the detectors. It is responsible for parsing data, identifying fire risk, screening for device faults, presenting maintenance prompts, and giving users a way to review results. This creates two parallel data paths: one monitors the building environment and can trigger a fire warning; the other monitors device health and can prompt maintenance. A device fault alert is for maintaining the warning system itself; it does not replace a fire alarm.

## 2. Fire monitoring: from infrared radiation to an alarm

```text
Infrared radiation in the environment
      ↓
Detector measures temperature and creates a digital signal
      ↓
Wireless module encodes and sends the temperature reading
      ↓
Receiver interprets temperature changes and assesses risk
      ↓
Fire risk warning is displayed for staff to respond to
```

The project paper describes the fire decision as follows: the receiver applies predefined risk criteria and looks for signals such as unusually high temperatures or rapid temperature changes. When the criteria are met, it issues a fire warning. The sensor and wireless link measure and deliver the readings; the receiver interprets them and alerts staff.

The available materials do not provide reproducible fire thresholds, a decision formula, or false alarm test results. They therefore do not establish the exact temperature or rate of change at which the system will alarm. Those parameters would need to be set using sensor calibration, the building environment, and measured data.

## 3. Device self-check: from operating metrics to maintenance advice

Fire detection uses environmental temperature. Device health monitoring instead focuses on the detector’s own operating metrics. The workflow document lists these fields:

- **Voltage and current:** indicate power supply and energy use.
- **Signal strength and response frequency:** describe the wireless link and device response.
- **Timestamp and device ID:** show how readings change over time and identify the device that produced them.
- **Location, if available:** links a device ID to its position on the building plan.

The proposed data flow covers collection, preprocessing, anomaly screening, trend forecasting, maintenance classification, and location based inspection:

```text
Periodically collect operating metrics and device IDs
      ↓
Record timestamps, check for missing or invalid values, and prepare numeric features
      ↓
Isolation Forest: flag observations that differ from the usual pattern
      ↓
Prophet: examine the future trend of voltage and other metrics
      ↓
XGBoost: combine metrics and classify whether maintenance is needed
      ↓
Match device IDs to the floor plan and provide inspection leads
```

The workflow document gives one example in which each detector sends health data every one to two hours. This is an example, not a confirmed final sampling interval. Its pseudocode first cleans and screens data locally, then uploads anomalies for trend forecasting and maintenance classification in the cloud. The paper and presentation slides describe AI processing more generally at the receiver or in the cloud, so the actual model deployment location still needs to be specified consistently.

### Step 1: Isolation Forest flags unusual readings

Isolation Forest builds a collection of isolation trees by randomly selecting features and splitting their value ranges. For each observation, the model measures how many splits are needed to isolate it in each tree and combines those path lengths into an anomaly score. A reading that differs markedly from most of the data is often isolated with fewer splits and is flagged as anomalous.

In this system, a sudden voltage drop, a signal strength far from its normal range, or an unusual combination of current and response frequency could be added to an inspection list. Isolation Forest **finds readings that differ from the observed distribution**; it does not prove that a particular hardware component has failed. The Python example in the project materials uses `-1` for an anomaly and `1` for a normal observation, with `contamination=0.01` as an example setting. The expected anomaly rate must be calibrated against real operating data and false alarm rates; it should not be treated as a fixed product specification.

### Step 2: Prophet tracks how a metric changes over time

Anomaly screening focuses on individual or local readings. Prophet focuses on how a metric changes over time. In the workflow example, timestamps for each device are placed in a `ds` column and voltage readings in a `y` column. The model is trained on this time series and returns a forecast with a central estimate and upper and lower bounds. If voltage keeps falling, the trend and forecast interval can provide a reason to inspect the power supply or storage battery.

A forecast is a projection based on the available history, not a fault diagnosis. One example forecasts 24 hours ahead; another document mentions 24 to 48 hours. The horizon, sampling interval, and metrics to forecast must be selected for the actual data. The AI principles document also notes that Prophet is better suited to longer time series with trends and seasonal patterns, so its performance on short histories or small datasets needs to be tested separately.

### Step 3: XGBoost classifies maintenance needs

XGBoost is a supervised classification method. The workflow describes voltage, current, signal strength, and response frequency as input features, with `needs_maintenance` as the training label. From labeled examples, the model learns relationships between combinations of metrics and maintenance status, then classifies new readings as normal or requiring maintenance. The training materials also mention splitting data into training and validation sets and evaluating the model with metrics such as accuracy.

This step depends on trustworthy historical labels. A technician must inspect a device and confirm whether it needed repair before that outcome can become a useful training label. If labels are generated only from preset thresholds or simulated rules, the model may simply learn those rules instead of detecting real field failures. Its classification should therefore be treated as a maintenance priority suggestion, followed by human inspection.

## 4. How the three methods work together

Their responsibilities can be summarized as follows:

| Stage | Method | Question answered | Main output |
|---|---|---|---|
| Anomaly screening | Isolation Forest | Which observations differ markedly from the usual pattern? | Anomaly records and scores or labels |
| Trend forecasting | Prophet | How might a metric change next? | Time series forecast and interval |
| Maintenance classification | XGBoost | Which devices should be prioritized for maintenance? | Normal or maintenance-needed class |

Together, these form an **analysis workflow** from monitoring to maintenance. This does not necessarily mean that the output of each model becomes the input to the next. The workflow document says that XGBoost is trained on sensor metrics and maintenance labels; it does not clearly state that Isolation Forest anomaly scores or Prophet forecasts are XGBoost features. The final system diagram should show the data interfaces and specify whether the methods run in sequence, in parallel, or are combined by receiver-side rules.

## 5. Turning anomalies into inspection leads

Once a model flags a device ID, the receiver can look up that ID on the building plan to help staff find its location. The readings can then narrow down what to inspect first. For example, persistently low power or voltage may warrant checking the low-light photovoltaic cell, storage battery, or energy management circuit. Weak wireless signal or an unusual response frequency may warrant checking the communication link or infrared sensing module. The project’s Q&A notes describe an interactive chart that would show the device ID and its readings when a user hovers over a point.

These are **possible causes** to guide an inspection; a single metric does not map one-to-one to a failed component. After maintenance, staff should record what they found, what they repaired, and the result of a follow-up check. If the project moves into continuous operation, confirmed service records could provide more reliable labels for improving models and thresholds over time. The archived materials do not yet show a complete maintenance feedback process.
