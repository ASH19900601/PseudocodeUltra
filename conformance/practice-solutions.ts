// Test-only reference implementations. These are never imported by the application.
export const practiceSolutions: Record<string, string> = {
  "sum-two": `DECLARE A, B : INTEGER
INPUT A
INPUT B
OUTPUT A + B`,
  temperature: `DECLARE Temperature : INTEGER
INPUT Temperature
IF Temperature <= 0 THEN
    OUTPUT "FREEZING"
ELSE
    IF Temperature < 30 THEN
        OUTPUT "MILD"
    ELSE
        OUTPUT "HOT"
    ENDIF
ENDIF`,
  staircase: `DECLARE N, Total, I : INTEGER
INPUT N
Total ← 0
FOR I ← 1 TO N
    Total ← Total + I
NEXT I
OUTPUT Total`,
  "array-stats": `DECLARE Values : ARRAY[1:5] OF INTEGER
DECLARE I, Highest, Count : INTEGER
FOR I ← 1 TO 5
    INPUT Values[I]
NEXT I
Highest ← Values[1]
Count ← 0
FOR I ← 1 TO 5
    IF Values[I] > Highest THEN
        Highest ← Values[I]
    ENDIF
    IF Values[I] > 0 THEN
        Count ← Count + 1
    ENDIF
NEXT I
OUTPUT Highest
OUTPUT Count`,
  sentinel: `DECLARE Amount, Count, Total : INTEGER
Count ← 0
Total ← 0
INPUT Amount
WHILE Amount <> -1 DO
    Count ← Count + 1
    Total ← Total + Amount
    INPUT Amount
ENDWHILE
OUTPUT Count
OUTPUT Total`,
  vowels: `DECLARE Label, Letter : STRING
DECLARE I, Count : INTEGER
INPUT Label
Count ← 0
FOR I ← 1 TO LENGTH(Label)
    Letter ← SUBSTRING(Label, I, 1)
    IF Letter = "a" OR Letter = "e" OR Letter = "i" OR Letter = "o" OR Letter = "u" THEN
        Count ← Count + 1
    ENDIF
NEXT I
OUTPUT Count`,
  "first-search": `DECLARE Target, I, Position : INTEGER
DECLARE Values : ARRAY[1:6] OF INTEGER
INPUT Target
FOR I ← 1 TO 6
   INPUT Values[I]
NEXT I
Position ← 0
FOR I ← 1 TO 6
   IF Values[I] = Target AND Position = 0 THEN
      Position ← I
   ENDIF
NEXT I
OUTPUT Position`,
  "digit-sum": `FUNCTION DigitSum(N : INTEGER) RETURNS INTEGER
   DECLARE Total : INTEGER
   Total ← 0
   WHILE N > 0
      Total ← Total + N MOD 10
      N ← N DIV 10
   ENDWHILE
   RETURN Total
ENDFUNCTION
DECLARE Number : INTEGER
INPUT Number
OUTPUT DigitSum(Number)`,
  "matrix-columns": `DECLARE Traffic : ARRAY[1:2,1:3] OF INTEGER
DECLARE Station, Slot, Total : INTEGER
FOR Station ← 1 TO 2
   FOR Slot ← 1 TO 3
      INPUT Traffic[Station, Slot]
   NEXT Slot
NEXT Station
FOR Slot ← 1 TO 3
   Total ← 0
   FOR Station ← 1 TO 2
      Total ← Total + Traffic[Station, Slot]
   NEXT Station
   OUTPUT Total
NEXT Slot`,
  "record-winner": `TYPE Member
   DECLARE Name : STRING
   DECLARE Score : INTEGER
ENDTYPE
DECLARE Members : ARRAY[1:3] OF Member
DECLARE I, Best : INTEGER
FOR I ← 1 TO 3
   INPUT Members[I].Name
   INPUT Members[I].Score
NEXT I
Best ← 1
FOR I ← 2 TO 3
   IF Members[I].Score > Members[Best].Score THEN
      Best ← I
   ENDIF
NEXT I
OUTPUT Members[Best].Name`,
};
