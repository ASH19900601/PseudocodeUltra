import type { PracticeExercise } from "./practice";

type ExerciseCopy = Pick<
  PracticeExercise,
  | "title"
  | "topics"
  | "statement"
  | "inputContract"
  | "outputContract"
  | "starter"
> & {
  cases: { criterion: string; advice: string }[];
};

export const practiceEnglish: Record<string, ExerciseCopy> = {
  "sum-two": {
    title: "01 · Total stock movement",
    topics: ["Input / output", "Integer arithmetic"],
    statement:
      "A warehouse records two stock movements as signed integers. Calculate the combined movement. A negative number means stock leaving the warehouse.",
    inputContract:
      "INPUT two INTEGER values, each from -1000 to 1000. Each INPUT reads one line.",
    outputContract:
      "OUTPUT one integer line containing their sum. Use only the required output, with no input prompts.",
    starter:
      "// TODO: Read both stock movements and output their total\nDECLARE First, Second : INTEGER\nINPUT First\nINPUT Second\n// TODO: Calculate and output the total\n",
    cases: [
      {
        criterion: "Adding positive values",
        advice: "Include both inputs in the addition.",
      },
      {
        criterion: "Mixed signs",
        advice: "Include negative stock movements in the sum.",
      },
      {
        criterion: "Zero values",
        advice: "Output the result even when it is zero.",
      },
      {
        criterion: "Negative values at the lower bound",
        advice: "The sum can be below the lower bound for a single input.",
      },
      {
        criterion: "Cancelling movements",
        advice: "Use signed addition and preserve each input's sign.",
      },
    ],
  },
  temperature: {
    title: "02 · Greenhouse temperature bands",
    topics: ["IF", "Boundary conditions"],
    statement:
      "Label a greenhouse temperature FREEZING when it is at most 0, MILD when it is above 0 and below 30, and HOT when it is at least 30.",
    inputContract: "INPUT one INTEGER temperature from -50 to 100.",
    outputContract:
      "OUTPUT exactly one uppercase label: FREEZING, MILD or HOT.",
    starter:
      "DECLARE Temperature : INTEGER\nINPUT Temperature\n// TODO: Output the label for the correct temperature band\n",
    cases: [
      {
        criterion: "Cold band",
        advice: "Temperatures at most 0 belong to FREEZING.",
      },
      {
        criterion: "Middle band",
        advice: "Check both boundaries of the middle band.",
      },
      {
        criterion: "Zero-degree boundary",
        advice: "Check which band includes 0.",
      },
      {
        criterion: "One degree below HOT",
        advice: "29 still belongs to the middle band.",
      },
      {
        criterion: "Thirty-degree boundary",
        advice: "Check that HOT includes 30.",
      },
    ],
  },
  staircase: {
    title: "03 · Staircase lights",
    topics: ["FOR", "Accumulators"],
    statement:
      "Floor 1 has 1 light on, floor 2 has 2, and so on up to floor N. Calculate the total number of lights on. N = 0 means there are no floors. Any equivalent algorithm is accepted.",
    inputContract: "INPUT one INTEGER N from 0 to 1000.",
    outputContract:
      "OUTPUT one integer line containing the sum from 1 to N. Output 0 when N = 0.",
    starter:
      "DECLARE N, Total, Level : INTEGER\nINPUT N\n// TODO: Calculate the total lights, including the N = 0 case\n",
    cases: [
      {
        criterion: "Several floors",
        advice: "Accumulate each floor's lights and output the final total.",
      },
      {
        criterion: "Single floor",
        advice: "Include the first floor in the loop.",
      },
      {
        criterion: "No floors",
        advice:
          "Initialize the accumulator so zero loop iterations still produce a result.",
      },
      {
        criterion: "Including the last floor",
        advice: "Include floor N in the loop.",
      },
      {
        criterion: "Upper input bound",
        advice: "The total can be much larger than N.",
      },
    ],
  },
  "array-stats": {
    title: "04 · Five-day growth statistics",
    topics: ["One-dimensional arrays", "Maximum", "Counting"],
    statement:
      "Read the net growth for five consecutive days. Find the maximum value and count the days with growth strictly greater than 0. An array is recommended for storing the five inputs.",
    inputContract: "INPUT five INTEGER values from -100 to 100, in day order.",
    outputContract:
      "OUTPUT two lines: the maximum of the five values, then the number of strictly positive values. Exclude 0 from the positive count.",
    starter:
      "DECLARE Values : ARRAY[1:5] OF INTEGER\nDECLARE I, Highest, PositiveCount : INTEGER\nFOR I ← 1 TO 5\n    INPUT Values[I]\nNEXT I\n// TODO: Output the maximum and positive count on separate lines\n",
    cases: [
      {
        criterion: "Mixed values",
        advice: "Track the maximum and positive count independently.",
      },
      {
        criterion: "All negative",
        advice:
          "Initialize the maximum from an input value so negative maxima are handled.",
      },
      {
        criterion: "Zero is excluded",
        advice: "Use a strictly greater than 0 condition for the count.",
      },
      {
        criterion: "First value is greatest",
        advice: "Include the first value in the statistics.",
      },
      {
        criterion: "Last value is greatest",
        advice: "Check that the array loop includes the fifth value.",
      },
    ],
  },
  sentinel: {
    title: "05 · Payment sentinel",
    topics: ["WHILE / REPEAT", "Sentinel values"],
    statement:
      "Read payment amounts until -1 marks the end. Count the valid payments and calculate their total. Exclude -1 from both statistics. An amount of 0 is a valid payment.",
    inputContract:
      "INPUT INTEGER amounts from 0 to 100, one per line, ending with -1. There are at most 20 valid payments, and the first input may be -1.",
    outputContract:
      "OUTPUT two integer lines: the number of valid payments, then their total amount. Output only these two statistics.",
    starter:
      "DECLARE Amount, Count, Total : INTEGER\n// TODO: Initialize the statistics and read until -1\n// TODO: Output the count and total on separate lines\n",
    cases: [
      {
        criterion: "Several payments",
        advice: "Exclude the sentinel from the total amount.",
      },
      {
        criterion: "Immediate end",
        advice:
          "Initialize the count and total before reading the first payment.",
      },
      { criterion: "Zero is valid", advice: "Use -1 as the only end marker." },
      {
        criterion: "Repeated amounts and upper bound",
        advice: "Count repeated amounts as separate valid payments.",
      },
      {
        criterion: "Longer payment stream",
        advice:
          "Keep reading until the sentinel, rather than using a few fixed INPUT statements.",
      },
    ],
  },
  vowels: {
    title: "06 · Vowels in a label",
    topics: ["Strings", "SUBSTRING", "Loops"],
    statement:
      "Count all occurrences of the lowercase vowels a, e, i, o and u in a string. The input contains only lowercase English letters and may be empty.",
    inputContract:
      "INPUT one STRING line of length 0 to 40. An empty line represents an empty string.",
    outputContract:
      "OUTPUT one integer line containing the vowel count. Count every occurrence, including repeated vowels.",
    starter:
      "DECLARE Label : STRING\nDECLARE I, Count : INTEGER\nINPUT Label\n// TODO: Check each character and output the lowercase vowel count\n",
    cases: [
      {
        criterion: "Typical string",
        advice: "Check the characters one at a time.",
      },
      { criterion: "No vowels", advice: "Output 0 when there are no matches." },
      {
        criterion: "Empty string",
        advice: "An empty string needs zero character checks.",
      },
      {
        criterion: "Repeated vowels",
        advice: "Count occurrences of vowels, including repetitions.",
      },
      {
        criterion: "First and last characters",
        advice: "String positions start at 1. Include the final character.",
      },
    ],
  },
  "first-search": {
    title: "07 · First matching position",
    topics: ["Linear search", "Duplicate values", "Arrays"],
    statement:
      "Find a target value among six integers. Output its first position, starting from 1. Output 0 when the target is absent.",
    inputContract:
      "INPUT one target INTEGER, then six INTEGER values. All values range from -20 to 20.",
    outputContract:
      "OUTPUT one integer line from 0 to 6. For repeated matches, return the earliest position.",
    starter:
      "DECLARE Target, I, Position : INTEGER\nDECLARE Values : ARRAY[1:6] OF INTEGER\nINPUT Target\nFOR I ← 1 TO 6\n   INPUT Values[I]\nNEXT I\n// TODO: Output the first matching position, or 0\n",
    cases: [
      {
        criterion: "Earliest repeated match",
        advice:
          "Preserve the first matching position when later matches are found.",
      },
      {
        criterion: "Target absent",
        advice: "Initialize the absent result and output it once at the end.",
      },
      {
        criterion: "First position",
        advice: "Start the search at position 1.",
      },
      {
        criterion: "Last position",
        advice: "Include position 6 in the search.",
      },
      {
        criterion: "Every value matches",
        advice: "Return the first position even when all values match.",
      },
    ],
  },
  "digit-sum": {
    title: "08 · Sum of a number's digits",
    topics: ["Subprograms", "DIV / MOD", "Return values"],
    statement:
      "Read a non-negative integer and output the sum of its digits. A DigitSum function is recommended. Grading accepts any equivalent implementation that meets the input and output contract.",
    inputContract:
      "INPUT one INTEGER Number from 0 to 99999. The input has no leading zeros, except for the number 0 itself.",
    outputContract:
      "OUTPUT one integer line containing the sum of the decimal digits. Output 0 when Number = 0.",
    starter:
      "// Suggested: FUNCTION DigitSum(N : INTEGER) RETURNS INTEGER\n// TODO: Extract digits using DIV and MOD\nDECLARE Number : INTEGER\nINPUT Number\n// TODO: Output the digit sum\n",
    cases: [
      {
        criterion: "Multiple digits",
        advice: "Include every digit in the sum.",
      },
      { criterion: "Zero", advice: "Output a result for an input of zero." },
      {
        criterion: "Single digit",
        advice: "Include the final digit in the loop.",
      },
      {
        criterion: "Zeros between digits",
        advice:
          "Use integer DIV to update the number and MOD to get its last digit.",
      },
      {
        criterion: "Largest five-digit value",
        advice: "Handle all five digits as decimal values.",
      },
    ],
  },
  "matrix-columns": {
    title: "09 · Passenger totals by time slot",
    topics: ["Two-dimensional arrays", "Nested loops"],
    statement:
      "A passenger table has two rows for stations and three columns for time slots. Calculate each time slot's total across both stations and output the totals in time-slot order.",
    inputContract:
      "INPUT six INTEGER values from 0 to 1000 in row order: the three time slots for station 1, then the three for station 2.",
    outputContract:
      "OUTPUT three integer lines: the column totals for time slots 1, 2 and 3, one per line.",
    starter:
      "DECLARE Traffic : ARRAY[1:2,1:3] OF INTEGER\nDECLARE Station, Slot, Total : INTEGER\nFOR Station ← 1 TO 2\n   FOR Slot ← 1 TO 3\n      INPUT Traffic[Station, Slot]\n   NEXT Slot\nNEXT Station\n// TODO: Sum each column and output three lines\n",
    cases: [
      {
        criterion: "Column totals",
        advice: "Output by time slot, combining both stations for each slot.",
      },
      {
        criterion: "All-zero table",
        advice: "Output a result for every slot, including zero totals.",
      },
      {
        criterion: "Corner values",
        advice: "Check the two array indices and the row input order.",
      },
      {
        criterion: "Independent column totals",
        advice: "Reset the total before calculating each column.",
      },
      {
        criterion: "Upper total bound",
        advice: "A column total can exceed the range of one input cell.",
      },
    ],
  },
  "record-winner": {
    title: "10 · Best club result",
    topics: ["Records", "Arrays", "Tie handling"],
    statement:
      "Read three members' names and scores. Output the name of the member with the highest score. For tied highest scores, keep the earliest member in input order. Records are recommended for storing names and scores.",
    inputContract:
      "INPUT a name and a score for each of three members, for six lines total. Names are STRING values of 1 to 12 English letters. Scores are INTEGER values from 0 to 100.",
    outputContract:
      "OUTPUT one line containing the winner's name with its original letter case.",
    starter:
      "TYPE Member\n   DECLARE Name : STRING\n   DECLARE Score : INTEGER\nENDTYPE\nDECLARE Members : ARRAY[1:3] OF Member\nDECLARE I, Best : INTEGER\nFOR I ← 1 TO 3\n   INPUT Members[I].Name\n   INPUT Members[I].Score\nNEXT I\n// TODO: Find the highest score and output the name using the tie rule\n",
    cases: [
      {
        criterion: "Middle member wins",
        advice: "Keep each name associated with its score.",
      },
      {
        criterion: "Earliest tied member",
        advice: "Update the best position only for a strictly higher score.",
      },
      {
        criterion: "All scores zero",
        advice: "Initialize the candidate to the first member.",
      },
      {
        criterion: "First member and letter case",
        advice: "Preserve the original letter case when outputting the name.",
      },
      {
        criterion: "Last member wins",
        advice: "Check that the loop includes the third member.",
      },
    ],
  },
};
