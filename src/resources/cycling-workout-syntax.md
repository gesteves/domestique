# Intervals.icu Cycling Workout Syntax

This document describes the plain-text syntax for creating structured cycling workouts in Intervals.icu. You **MUST** use this exact format to generate workout files that can be imported directly.

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

| Type | Syntax | Examples |
|------|--------|----------|
| Percent of FTP | `N%` | `75%`, `88%`, `95-105%` |
| Watts | `Nw` | `220w`, `200-240w` |

**Example:**

```
- 10m 75%
- 5m 250-270w
- 20m 88-92%
```

## Cadence

Append `rpm` to specify target cadence:

```
- 10m 75% 90rpm
- 5m 88% 70rpm
- 12m 85% 90-100rpm
```

## Ramps

Gradual intensity changes use the `ramp` keyword (case-insensitive):

```
- 10m ramp 50-75%
- 15m ramp 60-90% 85rpm
```

## Freeride (ERG Off)

For unstructured efforts without ERG control:

```
- 20m freeride
```

## Repeats

Two methods to define repeats:

**In section header:**

```
Main Set 5x
- 3m 120%
- 2m 50%
```

**Standalone line:**

```
5x
- 3m 120%
- 2m 50%
```

Nested repeats are not supported.

## Text Prompts

Any text before the first duration/intensity becomes the step cue:

```
- Recovery spin 30s 50%
- High cadence! 4m 75% 100rpm
```

### Timed Text Prompts

Add prompts at specific times within a step using `time^` syntax and `<!>` separator:

```
- Settle in 33^Find your rhythm <!> 10m ramp 50-75%
```

## Complete Examples

### VO2 Max Intervals

```
Warmup
- 10m ramp 50-65% 90rpm

Main Set 5x
- 3m 120% 100rpm
- 2m 50% 85rpm

Cooldown
- 8m ramp 50-40% 80rpm
```

### Sweet Spot

```
Warmup
- 10m ramp 50-70% 90rpm
- 5m 75% 95rpm

Main Set 3x
- 15m 88-92% 85rpm
- 5m 55% 90rpm

Cooldown
- 10m ramp 55-40% 85rpm
```

### Threshold Intervals

```
Warmup
- 15m ramp 50-75% 90rpm

Main Set 4x
- 8m 100-105% 90rpm
- 4m 50% 85rpm

Cooldown
- 10m ramp 55-40% 85rpm
```

### Over-Unders

```
Warmup
- 10m ramp 50-70% 90rpm
- 5m 80% 90rpm

Main Set 3x
- 2m 95% 90rpm
- 1m 105% 95rpm
- 2m 95% 90rpm
- 1m 105% 95rpm
- 2m 95% 90rpm
- 5m 50% 85rpm

Cooldown
- 10m ramp 55-40% 85rpm
```

### Endurance Ride

```
Warmup
- 15m ramp 50-70% 90rpm

Main Set
- 90m 65-75% 85-95rpm

Cooldown
- 10m ramp 60-40% 85rpm
```

### Sprint Intervals

```
Warmup
- 15m ramp 50-75% 90rpm
- 3x 30s 110% 100rpm
- 3m 50% 85rpm

Main Set 8x
- 30s 150% 110rpm
- 2m30 50% 85rpm

Cooldown
- 10m ramp 55-40% 85rpm
```

### Freeride with Structure

```
Warmup
- 10m ramp 55-75% 90rpm

Main Set
- 20m freeride
- 5m 70% 90rpm
- 20m freeride

Cooldown
- 8m ramp 60-40% 85rpm
```

## Syntax Rules Summary

1. **Section headers**: Lines without `-` prefix
2. **Steps**: Lines starting with `-`
3. **Repeats**: `Nx` in header or standalone line before block
4. **Ranges**: Use hyphen `a-b` (e.g., `85-90%`, `200-240w`)
5. **Keywords**: Case-insensitive (`ramp`, `Ramp`, `RAMP` all work)
6. **Blank lines**: Use between sections for readability
7. **Cadence**: Optional, append `rpm` to any step

## Workflow

To create a workout, you **MUST**:

1. Fetch the user's cycling power zones via the get_sports_settings tool
2. Use your best judgment to interpret the description of the workout provided by the user to the correct workout structure
3. Verify the structure of the generated workout with the user, and adjust based on feedback
4. Create the workout using Intervals.icu syntax, ensuring that it adheres **EXACTLY** to these instructions
