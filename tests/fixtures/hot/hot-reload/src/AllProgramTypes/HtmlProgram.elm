module AllProgramTypes.HtmlProgram exposing (main)

import AllProgramTypes
import Html


main =
    Html.p [] [ Html.text ("HtmlProgram" ++ AllProgramTypes.suffix) ]
