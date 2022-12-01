port module AllProgramTypes.WorkerProgram exposing (main)

import AllProgramTypes


port input : (() -> msg) -> Sub msg


port output : String -> Cmd msg


main =
    Platform.worker
        { init = \() -> ( (), Cmd.none )
        , update = \_ model -> ( model, output ("WorkerProgram" ++ AllProgramTypes.suffix) )
        , subscriptions = always (input identity)
        }
