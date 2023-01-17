module AllProgramTypes.HtmlProgram exposing (main)

import Html
import AllProgramTypes


main =
    Html.p [] [ Html.text ("HtmlProgram" ++ AllProgramTypes.suffix) ]
