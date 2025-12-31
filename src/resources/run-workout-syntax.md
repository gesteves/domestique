# Intervals.icu Running Workout Syntax

This document describes the plain-text syntax for creating structured workouts in Intervals.icu. You **MUST** use this exact format to generate workout files that can be imported directly.

## Basic Structure

Workouts consist of **sections** (headers) and **steps** (lines starting with `-`). Sections group related steps and can define repeats.

```
Section Name
- step definition
- step definition

Another Section 3x
- repeated step
- repeated step
```

## Duration and Distance

### Time-Based Steps

| Format | Meaning | Examples |
|--------|---------|----------|
| `h` | hours | `1h` |
| `m` | minutes | `10m`, `5m` |
| `s` | seconds | `30s`, `90s` |
| Combined | minutes + seconds | `1m30` |
| Shorthand | apostrophe notation | `5'` (5 min), `30"` (30 sec), `1'30"` |

### Distance-Based Steps

| Format | Examples |
|--------|----------|
| `km` | `2km`, `0.4km`, `10km` |
| `mi` | `1mi`, `4.5mi` |

**Important:** `m` means minutes, not meters. Use `km` or `mi` for distance (e.g., `0.4km` for 400 meters).

## Intensity Targets

Absolute pace values use `mm:ss` format and can specify a single pace or a range.

| Syntax | Examples |
|--------|----------|
| Single pace | `6:30/km`, `7:00/mi` |
| Pace range | `7:15-7:00/km`, `8:00-7:30/mi` |

**Note**: You **MUST** use absolute paces to ensure maximum compatibility of the workout with Zwift and Garmin. **DO NOT** use pace zones or percentages of threshold pace.

**Pace Units:**

| Unit | Meaning |
|------|---------|
| `/km` | per kilometer |
| `/mi` | per mile |
| `/100m` | per 100 meters |
| `/500m` | per 500 meters |
| `/400m` | per 400 meters |
| `/250m` | per 250 meters |
| `/100y` | per 100 yards |

If no unit is specified, the athlete's default pace unit is used.

**Example with absolute pace:**
```
- 10m 7:15-7:00/km Pace
- 1km 4:30/km Pace
- 800m 3:20/km Pace
```

## Ramps

Gradual intensity changes use the `ramp` keyword (case-insensitive):

```
- 10m ramp 7:15-7:00/km pace
```

## Repeats

Two methods to define repeats:

**In section header:**
```
Main Set 5x
- 3m 4:30-5:00/km pace
- 2m 7:15-7:00/km pace
```

**Standalone line:**
```
5x
- 3m 4:30-5:00/km pace
- 2m 7:15-7:00/km pace
```

Nested repeats are not supported.

## Text Prompts

Any text before the first duration/intensity becomes the step cue:

```
- Recovery 30s 7:00/km pace
- Run hard! 4m 4:30/km pace
```

### Timed Text Prompts

Add prompts at specific times within a step using `time^` syntax and `<!>` separator:

```
- First prompt 33^Second prompt at 33s <!> 10m ramp 4:30-5:00/km pace
```

## Complete Examples

### Long Run with Marathon Pace

```
Warmup
- 2km 70-75% pace
- 2km 75-78% pace
- 2km 78-82% pace

Main Set 2x
- 6km 90-92% pace
- 2km 75-80% pace

Cooldown
- 2km 72-76% pace
```

### Running Intervals with Absolute Pace

```
Warmup
- 10m 6:00-5:30/km Pace

Main Set 6x
- 1km 4:15/km Pace
- 2m 6:00/km Pace

Cooldown
- 10m 5:45-6:15/km Pace
```

### Running Track Session

```
Warmup
- 2km Z2 Pace
- 4x 100m strides 3:30/km Pace

Main Set 5x
- 800m 3:20/km Pace
- 400m recovery 5:30/km Pace

Cooldown
- 2km Z1 Pace
```

## Syntax Rules Summary

1. **Section headers**: Lines without `-` prefix
2. **Steps**: Lines starting with `-`
3. **Repeats**: `Nx` in header or standalone line before block
4. **Ranges**: Use hyphen `a-b` (e.g. `7:00-6:30/km`)
5. **Keywords**: Case-insensitive (`ramp`, `Ramp`, `RAMP` all work)
6. **Blank lines**: Use between sections for readability
7. **Sport type**: Determined by workout metadata; steps can override with explicit HR or Pace keywords

## Workflow

Before creating a workout, you should:

1. Fetch the user's running pace zones and threshold pace via the get_sports_settings tool
2. Use your best judgment to map RPE descriptions from the TrainerRoad workout to the correct pace for each step
3. Verify the structure of the generated workout with the user, and adjust based on feedback
4. Create the workout using Intervals.icu syntax
