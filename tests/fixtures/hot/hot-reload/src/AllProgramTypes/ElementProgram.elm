module AllProgramTypes.ElementProgram exposing (main)

import Browser
import Html
import AllProgramTypes


main =
    Browser.element
        { init = \() -> ( (), Cmd.none )
        , view = always (Html.p [] [ Html.text ("ElementProgram" ++ AllProgramTypes.suffix) ])
        , update = \_ model -> ( model, Cmd.none )
        , subscriptions = always Sub.none
        }
