import json

with open('route_scheudle.json', 'r') as f:
    route_scheudle = json.load(f)

results = []

for route in route_scheudle:
    route_id = route["route_code"]
    schedule = route["schedule"]
    schedules = []
    stopIdSet = set()
    current_direction = None
    current_schedule = []

    for stop in schedule:
        if current_direction is not None and stop["direction_id"] != current_direction:
            if current_schedule: 
              schedules.append(current_schedule)
            current_schedule = []
            
        current_direction = stop["direction_id"]

        stopDirection = (stop["stop_id"], stop["direction_id"])
        if stopDirection not in stopIdSet:
          stopIdSet.add(stopDirection)
          current_schedule.append({
              "stop_id": stop["stop_id"],
              "stop_name": stop["stop_name"],
              "direction_id": stop["direction_id"]
          })

    if current_schedule:
      schedules.append(current_schedule)

    results.append({
        "route_code": route_id,
        "stops": schedules
    })



results.sort(key=lambda r: int(r["route_code"]))
with open('route_schedule_clean.json', 'w') as f:
    json.dump(results, f, indent=2)