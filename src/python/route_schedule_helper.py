import json

with open('route_scheudle.json', 'r') as f:
    route_scheudle = json.load(f)

results = []

for route in route_scheudle:
    route_id = route["route_code"]
    schedule = route["schedule"]
    schedules = []
    stopIdSet = set()
    for stop in schedule:
        stopDirection = (stop["stop_id"], stop["direction_id"])
        if stopDirection not in stopIdSet:
          stopIdSet.add(stopDirection)
          schedules.append({
              "stop_id": stop["stop_id"],
              "stop_name": stop["stop_name"],
              "direction_id": stop["direction_id"]
          })
    results.append({
        "route_code": route_id,
        "stops": schedules
    })

with open('route_schedule_clean.json', 'w') as f:
    json.dump(results, f, indent=2)