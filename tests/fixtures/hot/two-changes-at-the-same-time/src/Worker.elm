module Worker exposing (main)


main : Program () () ()
main =
    Platform.worker
        { init = \() -> ( (), Cmd.none )
        , update = \() () -> ( (), Cmd.none )
        , subscriptions = always Sub.none
        }
