module AllProgramTypes.ElementProgram exposing (main)

import AllProgramTypes
import Browser
import Html


main =
    Browser.element
        { init = \() -> ( (), Cmd.none )
        , view = always (Html.p [] [ Html.text ("ElementProgram" ++ AllProgramTypes.suffix) ])
        , update = \_ model -> ( model, Cmd.none )
        , subscriptions = always Sub.none
        }
