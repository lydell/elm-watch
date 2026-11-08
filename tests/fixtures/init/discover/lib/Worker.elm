module Worker exposing (main)


main =
    Platform.worker { init = \() -> ( (), Cmd.none ), update = \_ m -> ( m, Cmd.none ), subscriptions = \_ -> Sub.none }
