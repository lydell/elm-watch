module AllProgramTypes.ApplicationProgram exposing (main)

import Browser
import Html
import AllProgramTypes


main =
    Browser.application
        { init = \() _ _ -> ( (), Cmd.none )
        , view = always { title = "AllProgramTypes", body = [ Html.p [] [ Html.text ("ApplicationProgram" ++ AllProgramTypes.suffix) ] ] }
        , update = \_ model -> ( model, Cmd.none )
        , subscriptions = always Sub.none
        , onUrlRequest = always ()
        , onUrlChange = always ()
        }
