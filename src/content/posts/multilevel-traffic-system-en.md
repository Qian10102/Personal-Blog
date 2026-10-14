---
title: "An Integrated Multilevel Transport System: Modeling Junction Control and Vertical Transitions"
description: "Follow a flying car through a multilevel junction to see how lanes, signals, sensing, and SysML models work together—and which project results and design targets remain unvalidated."
pubDate: 2026-10-08
category: "项目"
tags: ["Urban Mobility", "Flying Cars", "SysML", "Systems Engineering"]
language: "en"
featured: false
draft: false
---

The project, “Modeling and Simulation of a New Integrated Multilevel Transportation System,” explores how to bring surface roads, multiple low-altitude traffic levels, and routes between levels under one set of traffic rules. It envisions flying cars that can move between ground and air, coordinated through multilevel junctions, distributed lanes, sensing equipment, and signal control.

The central questions are how a vehicle receives permission to proceed, how it safely crosses between levels at a junction, and how those rules can be represented in a system model. This article introduces the system, follows a typical journey, and distinguishes documented progress from proposed design inputs.

<figure class="article-figure">
  <img src="/images/posts/multilevel-traffic/air-ground-comparison.jpg" alt="Project illustration comparing current ground-to-air travel with a proposed integrated multilevel transport system" loading="lazy" decoding="async" />
  <figcaption>The project archive’s comparison illustration: the upper panel shows a ground hub used for transfers between travel modes; the lower panel presents the concept of a flying car connecting ground and low-altitude routes through designated corridors. The original labels are in Chinese.</figcaption>
</figure>

## 1. System components

The project model divides the system into three parts: the flying car, the infrastructure, and fault handling with self-recovery. The midterm materials record that preliminary structural models had been built for the vehicle and infrastructure. Fault handling and self-recovery were still at the framework-design stage at that point.

### Flying car

The model uses a rotorcraft-style flying car as its representative vehicle, with four subsystems:

- **Energy support** supplies the onboard equipment and propulsion system, with parameters such as power used to describe energy constraints.
- **Control and communications** receives driver or dispatch commands and sends and receives data. A central computer and a backup computer process information.
- **Motion** uses propulsion and steering components to support ground, airborne, and between-level movement.
- **Spatial awareness** uses distance sensors to measure separation from nearby vehicles and an altitude sensor to measure height above the ground. An information-storage module holds data such as vehicle dimensions and safety distances.

### Infrastructure and traffic control

The infrastructure model contains energy support, information and communications with data processing, and sensing and signaling. Sensors gather junction and traffic-state information; data-processing and control modules coordinate vehicles; and traffic signals show permission to proceed and the allowed spatial route. Parameters such as road width and road height are also included in the model.

### Fault handling and self-recovery

This subsystem is intended to help the system enter a safe response process when a vehicle or traffic facility encounters an abnormal condition. One use-case example describes a propulsion failure: onboard sensors raise an alarm, the vehicle broadcasts a failure code, and a dispatch center assigns an emergency landing area and clears the corresponding route. This describes the intended response mechanism. The relevant SysML structural diagram was still unfinished in the midterm report, so the example does not establish that autonomous recovery has been implemented or validated.

<figure class="article-figure">
  <img src="/images/posts/multilevel-traffic/vehicle-system.svg" alt="SysML block definition diagram of the flying-car system, showing its energy, control and communications, motion, and spatial-awareness subsystems" loading="lazy" decoding="async" />
  <figcaption>Block definition diagram (BDD) of the flying-car system from the midterm model. It shows the main vehicle subsystems and their component relationships. The original diagram labels are in Chinese.</figcaption>
</figure>

## 2. A typical journey through a junction

The project proposal divides a typical trip into six phases: preflight preparation, route planning, takeoff, flight, landing preparation, and landing. The use-case description and cross-level activity diagram add detail about how a vehicle passes through a multilevel junction:

1. **Request permission to proceed.** As a flying car approaches a multilevel intersection, it reports its current level and intended direction and asks the traffic-control system for permission. The use-case draft gives 1 km from the junction as an example request trigger.
2. **Check position and validate commands.** Altitude and distance sensors provide the vehicle’s position and separation from nearby traffic. In the activity-diagram example, the system compares separation with the required safety distance. If the check fails, it displays an invalid-command state and prevents the propulsion system from starting; execution continues only after a successful check.
3. **Plan the route and assign a lane.** The control system assigns a route based on direction, current level, and lane load. Vehicles going straight remain on the main route at their level, while turning or changing-level traffic is directed to the corresponding junction corridor.
4. **Enter the junction according to signals.** A red light prohibits entry into the crossing area; a green arrow indicates an authorized spatial route. When a vehicle is preparing to change levels, traffic whose route conflicts with it must wait so that vehicles from different levels do not enter intersecting paths at the same time.
5. **Move within a level or between levels.** Movement within a level can include going straight, changing lanes, and slowing down. To change levels, a vehicle first enters a designated ascending or descending corridor, then changes altitude. In the activity-diagram example, the altitude sensor samples every 5 milliseconds and ends the transition when the vehicle reaches the target corridor’s altitude. This is a model-example parameter, not measured equipment performance.
6. **Leave the junction and continue along the route.** After crossing the junction, the vehicle joins the next lane segment or enters a cruising state. Traffic control updates lane load and plans passage for following vehicles.

<figure class="article-figure">
  <img src="/images/posts/multilevel-traffic/cross-layer-activity.svg" alt="Activity diagram for a flying car changing levels, including command and safety checks, altitude sampling, propulsion control, and a target-altitude decision" loading="lazy" decoding="async" />
  <figcaption>SysML activity diagram for a between-level transition. The model checks the command and safety separation, then samples altitude until the vehicle reaches the target corridor. The original diagram labels are in Chinese.</figcaption>
</figure>

The use-case description also proposes adjusting signal timing and routing some vehicles around a corridor when its lane load exceeds 90%. This is an example scheduling rule for the model; the threshold and its effect on traffic still require simulation validation.

## 3. How SysML represents the system

The project follows a model-based systems engineering approach to analyze requirements, structure, component interactions, behavior, parameters, and reliability. The proposal describes using the MagicGrid method to organize the problem, solution, and implementation domains, and MagicDraw for modeling. 3DEXPERIENCE is identified as the platform the project planned to use.

- **Requirements and use-case diagrams** describe what the system must do and how actors such as flying cars and traffic control cooperate.
- **Block definition diagrams (BDDs) and internal block diagrams (IBDs)** show which subsystems make up the system and how components connect and exchange information.
- **Activity, state-machine, and sequence diagrams** represent travel procedures, component interactions, and vehicle transitions among states such as stationary, takeoff, cruise, landing, and stopped.
- **Parametric diagrams** describe parameters and constraints such as road levels, route width, separation between levels, vehicle mass, and speed, providing inputs for later scenario analysis.

Command validation in the cross-level activity diagram is one concrete example. After the controller issues a command, the system uses spatial-awareness data to check the safety distance. Only a command that passes validation can activate the propulsion system. During a level change, the system repeatedly measures current altitude and compares it with the target level; reaching the target ends the transition.

## 4. Safety and reliability

The project proposal discusses reliability in terms of operating conditions, task duration, environmental effects, system failures, and accident consequences. The midterm materials say that an initial reliability-indicator framework had been developed, with further work planned to connect environmental adaptability, safety, recovery capability, and service life to the fault-handling model.

The use-case description lists example design inputs: a vertical transition speed of no more than 2 m/s, horizontal turning acceleration of no more than 1g, vehicle separation of at least 5 m horizontally and 3 m vertically, signal-command latency of no more than 50 ms, and peak throughput of at least 500 vehicles per minute at a single multilevel junction. The files also propose directional priorities and prohibiting between-level operation in severe weather. These values and rules come from a use-case draft. The available project materials provide no corresponding measurements or simulation results, so they should be treated as design inputs awaiting validation.

## 5. Project stage and validation boundaries

The midterm report records the following progress: preliminary structural models for the flying car and infrastructure, a typical cross-level activity diagram, and an initial reliability-indicator framework. It lists the fault-handling and self-recovery BDD, more detailed intersystem interactions, an operational demonstration, and simulations of normal and accident scenarios as future work.

Accordingly, the project’s preliminary models, proposed design concepts, and unfinished demonstrations, tests, and validation should be kept distinct. The available materials support an explanation of the system mechanisms and modeling approach, but they do not show deployment on real flying cars or urban infrastructure, nor do they provide validation results for the performance targets above.

### Sources

This article is based on the project proposal, midterm presentation, use-case description, and SysML modeling notes. The illustrations come from the project archive’s mode-comparison image, flying-car BDD, and cross-level activity diagram. The diagrams retain their original Chinese labels.
