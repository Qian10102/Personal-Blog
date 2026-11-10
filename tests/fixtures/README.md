# Timetable import fixture

`review-timetable-notes.xlsx` contains synthetic courses and was generated with
openpyxl 3.1.5. It reproduces the ExcelJS 4.4.0 import failure caused by notes at
`xl/comments/comment1.xml` and absolute worksheet relationship targets. It also
contains native time cells, an external hyperlink with an escaped ampersand, and
a second worksheet to check that ignoring notes preserves unrelated content.
